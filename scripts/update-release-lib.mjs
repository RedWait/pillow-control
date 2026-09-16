import { createHash } from "node:crypto";
export const repo = "RedWait/pillow-control";
export function stable(version) {
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)) throw Error("Release version must be stable x.y.z");
  return version;
}
export function names(version) {
  stable(version);
  const prefix = "pillow-control-" + version;
  return { setup: prefix + "-setup-x64.exe", signature: prefix + "-setup-x64.exe.sig",
    portable: prefix + "-portable-x64.zip", hashes: prefix + "-SHA256SUMS.txt", metadata: "latest.json" };
}
export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
// Tauri may rewrite Cargo.toml with LF on Windows. Ignore only that
// serialization difference; all other source and binary bytes stay exact.
export function sourceFileHash(file, bytes) {
  return hash(file === "src-tauri/Cargo.toml"
    ? bytes.toString("utf8").replace(/\r\n/g, "\n") : bytes);
}
export function metadata(version, signature, notes, date = new Date().toISOString()) {
  stable(version);
  if (!signature.trim() || !Number.isFinite(Date.parse(date))) throw Error("Missing signature or invalid date");
  return { version, notes, pub_date: date, platforms: { "windows-x86_64": {
    signature: signature.trim(),
    url: "https://github.com/" + repo + "/releases/download/v" + version + "/" + names(version).setup,
  } } };
}
export function assertMetadata(value, version, signature) {
  const expected = metadata(version, signature, value.notes, value.pub_date);
  if (value.version !== version || !value.notes?.trim() || !value.pub_date ||
      JSON.stringify(value.platforms) !== JSON.stringify(expected.platforms)) throw Error("Update metadata mismatch");
}
