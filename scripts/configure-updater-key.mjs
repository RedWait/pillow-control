import { readFile, writeFile } from "node:fs/promises";
const path = process.argv[2];
if (!path) throw Error("Usage: npm run updater:key -- PATH_TO_PUBLIC_KEY.pub");
const key = (await readFile(path, "utf8")).trim();
const decoded = Buffer.from(key, "base64").toString("utf8");
const lines = decoded.trim().split(/\r?\n/);
if (!lines[0]?.startsWith("untrusted comment:") || lines.length !== 2 ||
    Buffer.from(lines[1], "base64").length !== 42 || !lines[1].startsWith("RW")) {
  throw Error("Expected a Tauri updater PUBLIC key file, not a private key");
}
const config = JSON.parse(await readFile("src-tauri/tauri.conf.json", "utf8"));
config.plugins.updater.pubkey = key;
await writeFile("src-tauri/tauri.conf.json", JSON.stringify(config, null, 2) + "\n");
console.log("Updater public key configured. The private key was not read.");
