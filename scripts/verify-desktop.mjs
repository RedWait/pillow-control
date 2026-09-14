// Uses WebView2's opt-in local debugging only in this developer test process.
import { spawn, execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { once } from "node:events";
const exe = resolve(
  process.env.PILLOW_EXECUTABLE ||
    "src-tauri/target/release/pillow-control.exe",
);
const port = 19331;
await mkdir("output/playwright", { recursive: true });
await mkdir("artifacts", { recursive: true });
const env = {
  ...process.env,
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
  Path: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
};
delete env.PATH;
const app = spawn(exe, [], { env, cwd: process.env.TEMP, windowsHide: true });
const exit = once(app, "exit");
let browser;
const checks = {};
try {
  for (let i = 0; i < 100; i++) {
    if (
      await fetch(`http://127.0.0.1:${port}/json/version`).then(
        (r) => r.ok,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context = browser.contexts()[0];
  let page;
  for (let i = 0; i < 50; i++) {
    page = context.pages()[0];
    if (page) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await page.getByRole("button", { name: "停止遥控", exact: true }).waitFor();
  assert.equal(await page.title(), "枕控 PillowControl");
  checks.desktopStarted = true;
  const invoke = (cmd, args = {}) =>
    page.evaluate(
      ({ cmd, args }) => window.__TAURI_INTERNALS__.invoke(cmd, args),
      { cmd, args },
    );
  const state = await invoke("desktop_state");
  assert(
    state.running &&
      state.code.length === 6 &&
      state.addresses.some((a) => !a.virtual),
  );
  checks.localCommandsAndAdapters = true;
  const origin = `http://${state.selected}:${state.port}`;
  checks.embeddedMobile = (await fetch(origin).then((r) => r.text())).includes(
    "枕控 PillowControl",
  );
  checks.qrRendered = await page
    .locator("img")
    .evaluate((img) => img.complete && img.naturalWidth > 0);
  checks.unknownCommandDenied = await invoke("execute_shell", {
    command: "never-run",
  }).then(
    () => false,
    () => true,
  );
  await page.screenshot({
    path: "output/playwright/tauri-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "停止遥控", exact: true }).click();
  await page.getByRole("button", { name: "启动遥控", exact: true }).waitFor();
  checks.stopClosesPort = await fetch(origin).then(
    () => false,
    () => true,
  );
  await page.getByRole("button", { name: "启动遥控", exact: true }).click();
  await page.getByRole("button", { name: "停止遥控", exact: true }).waitFor();
  checks.restart = true;
  const native = (action) =>
    JSON.parse(
      execFileSync(
        "powershell",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("scripts/verify-window.ps1"),
          "-TargetProcessId",
          String(app.pid),
          "-Action",
          action,
        ],
        { encoding: "utf8" },
      ),
    );
  native("close");
  await new Promise((r) => setTimeout(r, 250));
  checks.closeHidesToTray = !native("state").visible;
  checks.hiddenServiceStillRuns = (await fetch(origin)).ok;
  const second = spawn(exe, [], {
    env,
    cwd: process.env.TEMP,
    windowsHide: true,
  });
  await once(second, "exit");
  await new Promise((r) => setTimeout(r, 250));
  checks.singleInstanceRestores = native("state").visible;
  native("minimize");
  await new Promise((r) => setTimeout(r, 250));
  checks.minimizeHidesToTray = !native("state").visible;
  const third = spawn(exe, [], {
    env,
    cwd: process.env.TEMP,
    windowsHide: true,
  });
  await once(third, "exit");
  await invoke("desktop_action", { action: "quit" }).catch(() => {});
  const code = await Promise.race([
    exit,
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Quit timeout")), 8000),
    ),
  ]);
  checks.quitClean = code[0] === 0;
  checks.exitClosesPort = await fetch(origin).then(
    () => false,
    () => true,
  );
  await writeFile(
    "artifacts/tauri-desktop-verification.json",
    JSON.stringify({ exe, at: new Date().toISOString(), checks }, null, 2),
  );
  for (const [name, value] of Object.entries(checks)) assert(value, name);
  console.log(checks);
} finally {
  if (browser) await browser.close().catch(() => {});
  if (app.exitCode === null) app.kill();
}
