import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
let output = "枕控 PillowControl — Third-party licenses\n\n";
async function files(dir) {
  for (const file of await readdir(dir, { withFileTypes: true })) {
    if (/^(licen[cs]e|copying|notice|copyright)/i.test(file.name)) {
      if (file.isDirectory()) await files(join(dir, file.name));
      else
        output += "\n" + (await readFile(join(dir, file.name), "utf8")) + "\n";
    }
  }
}
const seen = new Set();
async function js(name, parent = process.cwd()) {
  let current = parent,
    dir;
  while (true) {
    const candidate = join(current, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      dir = candidate;
      break;
    }
    const up = dirname(current);
    if (up === current) throw Error(`Missing dependency ${name}`);
    current = up;
  }
  if (seen.has(dir)) return;
  seen.add(dir);
  const p = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
  output += `\n===== ${p.name} ${p.version} (${p.license}) =====\n`;
  await files(dir);
  for (const dependency of Object.keys(p.dependencies || {}))
    await js(dependency, dir);
}
for (const name of ["vue", "qrcode", "@tauri-apps/api"]) await js(name);
const local = join(process.env.USERPROFILE || "", ".cargo", "bin", "cargo.exe");
const metadata = JSON.parse(
  execFileSync(
    existsSync(local) ? local : "cargo",
    [
      "metadata",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--format-version",
      "1",
      "--locked",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  ),
);
for (const p of metadata.packages
  .filter((p) => p.source)
  .sort((a, b) => a.name.localeCompare(b.name))) {
  output += `\n===== ${p.name} ${p.version} (${p.license || "see source"}) ${p.repository || ""} =====\n`;
  await files(dirname(p.manifest_path));
  if (p.license_file)
    output +=
      "\n" +
      (await readFile(join(dirname(p.manifest_path), p.license_file), "utf8"));
}
await mkdir("tauri-dist", { recursive: true });
await writeFile("tauri-dist/THIRD_PARTY_LICENSES.txt", output);
console.log("Generated complete dependency license texts.");
