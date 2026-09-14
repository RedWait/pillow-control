import { spawn } from "node:child_process";
import electron from "electron";
const exe = process.env.PILLOW_EXECUTABLE || electron;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  exe,
  [...(process.env.PILLOW_EXECUTABLE ? [] : ["."]), "--verify-windows"],
  { stdio: "inherit", env },
);
child.on("exit", (code) => process.exit(code ?? 1));
