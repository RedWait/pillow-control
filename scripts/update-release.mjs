// Explicit maintainer commands only. Never runs during normal pack or app startup.
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { repo, stable, names, metadata, assertMetadata, hash } from "./update-release-lib.mjs";
const [mode, notesPath] = process.argv.slice(2);
if (process.platform !== "win32" || process.arch !== "x64") throw Error("Release packaging requires Windows x64");
if (!["prepare", "publish"].includes(mode) || !notesPath) throw Error("Usage: update-release.mjs prepare|publish RELEASE_NOTES.md");
const run = (exe, args, options = {}) => execFileSync(exe, args, { stdio: "pipe", ...options });
const node = args => run(process.execPath, args, { stdio: "inherit" });
const installedGh = join(process.env.ProgramFiles || "C:/Program Files", "GitHub CLI/gh.exe");
const ghExe = existsSync(installedGh) ? installedGh : "gh";
const gh = args => run(ghExe, args, { encoding: "utf8" });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
const version = stable(pkg.version), n = names(version), tag = "v" + version;
const cargo = await readFile("src-tauri/Cargo.toml", "utf8");
if (config.version !== version || cargo.match(/^version = "([^"]+)"/m)?.[1] !== version) throw Error("package.json, Cargo.toml and tauri.conf.json versions must match");
const notes = await readFile(notesPath, "utf8");
if (!notes.trim()) throw Error("Release notes are required");
const key = config.plugins?.updater?.pubkey;
if (!key || !Buffer.from(key, "base64").toString().startsWith("untrusted comment:")) throw Error("Configure the updater PUBLIC key first: npm run updater:key -- PUBLIC_KEY.pub");
if (config.bundle.windows.webviewInstallMode.type !== "offlineInstaller" ||
    config.plugins.updater.windows.installMode !== "basicUi" ||
    Object.keys(config.plugins.updater).some(k => k.startsWith("dangerous") && config.plugins.updater[k])) throw Error("Unexpected update/installer security configuration");
const dir = resolve("release", "updates", tag);
const cargoExe = join(process.env.USERPROFILE, ".cargo/bin/cargo.exe");
function sourceDigest() {
  const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean).sort();
  return Promise.all(files.map(async file => file + "\0" + hash(await readFile(file)))).then(items => hash(items.join("\n")));
}
async function verify() {
  const publicPath = join(dir, "updater-public.pub");
  await writeFile(publicPath, key + "\n");
  run(cargoExe, ["run", "--locked", "--manifest-path", resolve("src-tauri/Cargo.toml"),
    "--example", "verify_update", "--", join(dir, n.setup), join(dir, n.signature), publicPath], { stdio: "inherit" });
}
if (mode === "prepare") {
  if (!process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD === undefined) throw Error("Set TAURI_SIGNING_PRIVATE_KEY (outside-repo path) and TAURI_SIGNING_PRIVATE_KEY_PASSWORD in this shell. Do not paste keys in chat.");
  if (existsSync(dir)) throw Error("Staging directory already exists; use a new version or inspect it manually. Nothing was overwritten.");
  const sourceHash = await sourceDigest();
  // createUpdaterArtifacts is enabled only for a signed release build.
  node(["scripts/tauri.mjs", "build", "--config", resolve("src-tauri/tauri.updater.conf.json")]);
  node(["scripts/package-portable.mjs"]);
  await mkdir(dir, { recursive: true });
  const source = resolve("src-tauri/target/release/bundle/nsis");
  const candidates = (await readdir(source)).filter(f => f.endsWith("-setup.exe") && f.includes("_" + version + "_"));
  if (candidates.length !== 1) throw Error("Expected exactly one version-matching NSIS installer");
  const setup = candidates[0];
  await copyFile(join(source, setup), join(dir, n.setup));
  await copyFile(join(source, setup + ".sig"), join(dir, n.signature));
  await copyFile(resolve("release", n.portable), join(dir, n.portable));
  await verify();
  const signature = await readFile(join(dir, n.signature), "utf8");
  await writeFile(join(dir, n.metadata), JSON.stringify(metadata(version, signature, notes), null, 2) + "\n");
  const manifest = [];
  for (const file of [n.setup, n.signature, n.portable, n.metadata]) {
    manifest.push(hash(await readFile(join(dir, file))) + "  " + file);
  }
  await writeFile(join(dir, n.hashes), manifest.join("\n") + "\n");
  if (await sourceDigest() !== sourceHash) throw Error("Source changed during packaging. Staging retained for review.");
  await writeFile(join(dir, "source.json"), JSON.stringify({ sourceHash, version }));
  console.log("Prepared and signature-verified: " + dir + ". Nothing was published.");
} else {
  if (run("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()) throw Error("Commit and review the release source first; worktree is dirty.");
  const receipt = JSON.parse(await readFile(join(dir, "source.json"), "utf8"));
  if (receipt.sourceHash !== await sourceDigest() || receipt.version !== version) throw Error("Source differs from the staged build; refusing to publish.");
  const commit = run("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const source = JSON.parse(gh(["api", "repos/" + repo + "/commits/" + commit]));
  if (source.sha !== commit) throw Error("Push the reviewed source commit before publishing.");
  // Paginated JSON parsed as an array of arrays. Refuse existing drafts/tags, never clobber.
  const releases = JSON.parse(gh(["api", "--paginate", "--slurp", "repos/" + repo + "/releases?per_page=100"])).flat();
  if (releases.some(r => r.tag_name === tag)) throw Error("Release/tag already exists; refusing to overwrite assets.");
  const tags = run("git", ["ls-remote", "--tags", "https://github.com/" + repo + ".git", "refs/tags/" + tag], { encoding: "utf8" });
  if (tags.trim()) throw Error("Remote tag already exists; choose a new version.");
  const compare = (a,b) => {
    const aa = a.split(".").map(Number), bb = b.split(".").map(Number);
    return aa[0]-bb[0] || aa[1]-bb[1] || aa[2]-bb[2];
  };
  for (const r of releases.filter(r => !r.draft && !r.prerelease)) {
    const previous = r.tag_name.replace(/^v/, "");
    if (/^\d+\.\d+\.\d+$/.test(previous) && compare(version, previous) <= 0) throw Error("New stable version must exceed every published stable version.");
  }
  const signature = await readFile(join(dir, n.signature), "utf8");
  const meta = JSON.parse(await readFile(join(dir, n.metadata), "utf8"));
  assertMetadata(meta, version, signature);
  if (meta.notes !== notes) throw Error("Release notes changed after staging; prepare a reviewed matching release.");
  await verify();
  const assets = Object.values(n);
  const sums = await readFile(join(dir, n.hashes), "utf8");
  for (const file of assets.filter(f => f !== n.hashes)) {
    if (!sums.split("\n").includes(hash(await readFile(join(dir, file))) + "  " + file)) throw Error("Staged checksum mismatch: " + file);
  }
  gh(["release", "create", tag, ...assets.map(f => join(dir, f)), "--repo", repo,
    "--draft", "--target", commit, "--title", "枕控 PillowControl " + tag, "--notes-file", resolve(notesPath)]);
  const draft = JSON.parse(gh(["api", "repos/" + repo + "/releases/tags/" + tag]));
  if (!draft.draft || draft.prerelease || draft.assets.length !== assets.length) throw Error("Draft asset inventory mismatch. Draft retained for review.");
  for (const file of assets) {
    const a = draft.assets.find(a => a.name === file), bytes = await readFile(join(dir, file));
    if (!a || a.size !== bytes.length || a.state !== "uploaded") throw Error("Incomplete upload. Draft retained.");
    // Download authenticated draft assets and compare bytes before making them public.
    const remote = run(ghExe, ["api", "repos/" + repo + "/releases/assets/" + a.id,
      "-H", "Accept: application/octet-stream"], { maxBuffer: 600 * 1024 * 1024 });
    if (hash(remote) !== hash(bytes)) throw Error("Remote checksum mismatch. Draft retained.");
  }
  gh(["release", "edit", tag, "--repo", repo, "--draft=false", "--latest"]);
  console.log("Published verified stable release: https://github.com/" + repo + "/releases/tag/" + tag);
}
