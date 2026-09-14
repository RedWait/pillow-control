import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
const local = join(process.env.USERPROFILE || "", ".cargo", "bin", "cargo.exe");
const child = spawn(
  existsSync(local) ? local : "cargo",
  [...process.argv.slice(2), "--manifest-path", "src-tauri/Cargo.toml"],
  { stdio: "inherit" },
);
child.on("error", (e) => {
  console.error(e);
  process.exitCode = 1;
});
child.on("exit", (code) => (process.exitCode = code ?? 1));
