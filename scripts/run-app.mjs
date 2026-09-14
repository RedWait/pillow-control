import { spawn } from "node:child_process";
import { resolve } from "node:path";
const child = spawn(
  resolve("src-tauri/target/release/pillow-control.exe"),
  [],
  { stdio: "inherit" },
);
child.on("error", (e) => {
  console.error("请先 npm run build", e.message);
  process.exitCode = 1;
});
child.on("exit", (c) => (process.exitCode = c ?? 1));
