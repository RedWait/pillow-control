import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const version = JSON.parse(await readFile("package.json", "utf8")).version;
const name = `pillow-control-${version}-portable-x64`;
const dir = resolve("release", name);
await mkdir(dir, { recursive: true });
await mkdir(join(dir, "docs"), { recursive: true });
await copyFile(
  "src-tauri/target/release/pillow-control.exe",
  join(dir, "pillow-control.exe"),
);
for (const [source, target] of [
  ["LICENSE", "LICENSE"],
  ["README.md", "README.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
  ["docs/ACCEPTANCE.md", "docs/ACCEPTANCE.md"],
  ["docs/VALIDATION.md", "docs/VALIDATION.md"],
  ["docs/MIGRATION.md", "docs/MIGRATION.md"],
  ["docs/SECURITY.md", "docs/SECURITY.md"],
  ["docs/MOBILE_UI.md", "docs/MOBILE_UI.md"],
  ["docs/AUTOCONNECT.md", "docs/AUTOCONNECT.md"],
  ["tauri-dist/THIRD_PARTY_LICENSES.txt", "THIRD_PARTY_LICENSES.txt"],
])
  await copyFile(source, join(dir, target));
const installers = await readdir("src-tauri/target/release/bundle/nsis");
const setup = installers.find(
  (n) => n.endsWith("-setup.exe") && n.includes(version),
);
if (!setup) throw Error("Missing NSIS installer");
const setupPath = resolve("release", `pillow-control-${version}-setup-x64.exe`);
await copyFile(join("src-tauri/target/release/bundle/nsis", setup), setupPath);
// One explicit archive; no cleanup or recursive deletion of prior build outputs.
execFileSync(
  "powershell",
  [
    "-NoProfile",
    "-Command",
    `Compress-Archive -LiteralPath '${dir.replaceAll("'", "''")}' -DestinationPath '${resolve("release", name + ".zip").replaceAll("'", "''")}' -Force`,
  ],
  { stdio: "inherit" },
);
const hashes = [];
for (const file of [
  setupPath,
  resolve("release", name + ".zip"),
  join(dir, "pillow-control.exe"),
])
  hashes.push(
    `${createHash("sha256")
      .update(await readFile(file))
      .digest("hex")}  ${file}`,
  );
await writeFile(
  `release/pillow-control-${version}-SHA256SUMS.txt`,
  hashes.join("\n") + "\n",
);
console.log(hashes.join("\n"));
