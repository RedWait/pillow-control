// Developer acceptance test: actual Chromium page -> Rust WS -> real Windows APIs.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolve, basename } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function processRpc(exe, args, options = {}) {
  const child = spawn(exe, args, {
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
  });
  const pending = [],
    buffer = [];
  let failure;
  child.stderr.on("data", (d) => process.stderr.write(d));
  createInterface({ input: child.stdout }).on("line", (line) => {
    try {
      const v = JSON.parse(line);
      const p = pending.shift();
      p ? p.resolve(v) : buffer.push(v);
    } catch {}
  });
  const fail = (e) => {
    failure = e;
    for (const p of pending.splice(0)) p.reject(e);
  };
  child.on("error", fail);
  child.on("exit", (code) => fail(new Error(`Process exited: ${code}`)));
  const next = () =>
    buffer.length
      ? Promise.resolve(buffer.shift())
      : failure
        ? Promise.reject(failure)
        : new Promise((resolve, reject) => {
            const timer = setTimeout(
              () => reject(new Error("Diagnostic timeout")),
              12000,
            );
            pending.push({
              resolve: (v) => {
                clearTimeout(timer);
                resolve(v);
              },
              reject: (e) => {
                clearTimeout(timer);
                reject(e);
              },
            });
          });
  return {
    child,
    next,
    request: async (value) => {
      const answer = next();
      child.stdin.write(
        (typeof value === "string" ? value : JSON.stringify(value)) + "\n",
      );
      const v = await answer;
      if (!v.ok) throw Error(v.error);
      return v.result;
    },
  };
}
const exe = resolve(
  process.env.PILLOW_EXECUTABLE ||
    "src-tauri/target/release/pillow-control.exe",
);
const env = {
  ...process.env,
  Path: `${process.env.SystemRoot}\\System32;${process.env.SystemRoot}`,
};
delete env.PATH;
const app = processRpc(exe, ["--verify-server"], {
  env,
  cwd: process.env.TEMP,
});
let fixture, browser, before;
await mkdir("output/playwright", { recursive: true });
const checks = {};
const details = { exe, at: new Date().toISOString(), appPath: env.Path };
try {
  const ready = await app.next();
  assert(ready.ready);
  details.origin = ready.origin;
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    window.WebSocket = class extends Original {
      constructor(...args) {
        super(...args);
        window.testSocket = this;
      }
    };
  });
  await page.goto(ready.origin);
  await page.getByPlaceholder("000000").fill(ready.code);
  await page.getByRole("button", { name: "配对连接", exact: true }).click();
  await page.getByText("已连接电脑", { exact: true }).waitFor();
  checks.mobilePairing = true;
  before = await app.request({ action: "probe" });
  assert(before.volume >= 0, "No audio output");
  fixture = processRpc(resolve("artifacts/VerificationHost.exe"), []);
  const clipboardBefore = await fixture.request("clipboard-sequence");
  const target = await fixture.request("target");
  await wait(250);
  const send = (command) =>
    page.evaluate(
      (command) =>
        new Promise((resolve, reject) => {
          const socket = window.testSocket;
          const id = (window.testSequence = (window.testSequence || 10000) + 1);
          const timer = setTimeout(() => {
            socket.removeEventListener("message", listener);
            reject(Error("Ack timeout"));
          }, 4000);
          const listener = (e) => {
            const data = JSON.parse(e.data);
            if (data.kind === "ack" && data.id === id) {
              clearTimeout(timer);
              socket.removeEventListener("message", listener);
              data.error ? reject(Error(data.error)) : resolve();
            }
          };
          socket.addEventListener("message", listener);
          socket.send(JSON.stringify({ kind: "command", id, command }));
        }),
      command,
    );
  const from = await app.request({ action: "probe" });
  for (let i = 0; i < 80; i++) {
    const p = await app.request({ action: "probe" });
    const dx = target.x - p.x,
      dy = target.y - p.y;
    if (Math.abs(dx) < 8 && Math.abs(dy) < 8) break;
    await send({
      type: "move",
      dx: Math.max(-50, Math.min(50, Math.round(dx / 6))),
      dy: Math.max(-50, Math.min(50, Math.round(dy / 6))),
    });
  }
  const moved = await app.request({ action: "probe" });
  checks.realCursorMoved = moved.x !== from.x || moved.y !== from.y;
  await send({ type: "click", button: "left", count: 1 });
  await wait(120);
  checks.realClick = (await fixture.request("clicks")) === 1;
  const file = await fixture.request("notepad");
  await wait(2000);
  const initial = await fixture.request("read-notepad");
  assert(
    /Notepad|记事本/i.test(initial.name) &&
      initial.name.includes(basename(file)),
    "Test Notepad must own focus before typing",
  );
  const sample = "枕控中文输入验证 PillowControl 123 😀";
  await send({ type: "text", text: sample });
  await wait(300);
  details.notepad = await fixture.request("read-notepad");
  checks.notepadChinese = details.notepad.text.includes(sample);
  await send({ type: "volume", action: before.volume > 0.9 ? "down" : "up" });
  const changed = await app.request({ action: "probe" });
  checks.realVolumeChanged = Math.abs(changed.volume - before.volume) > 0.0001;
  await send({ type: "volume", action: "mute" });
  checks.realMuteChanged =
    (await app.request({ action: "probe" })).muted !== before.muted;
  await send({ type: "volume", action: "mute" });
  await app.request({ action: "restore-volume", value: before.volume });
  await fixture.request("target");
  await fixture.request("untop");
  await wait(150);
  const start = await app.request({ action: "probe" });
  await send({ type: "switch", action: "next" });
  await send({ type: "switch", action: "confirm" });
  await wait(250);
  const firstWindow = await app.request({ action: "probe" });
  await send({ type: "switch", action: "next" });
  checks.altHeld = (await app.request({ action: "probe" })).altHeld;
  await send({ type: "switch", action: "next" });
  checks.consecutiveSwitchKeepsAlt = (
    await app.request({ action: "probe" })
  ).altHeld;
  await send({ type: "switch", action: "confirm" });
  await wait(200);
  const switched = await app.request({ action: "probe" });
  checks.realWindowChanged =
    switched.foreground !== start.foreground && !switched.altHeld;
  details.switchWindows = [
    start.foreground,
    firstWindow.foreground,
    switched.foreground,
  ];
  checks.thirdWindowReached = new Set(details.switchWindows).size === 3;
  await send({ type: "switch", action: "next" });
  await page.evaluate(() => window.testSocket.close());
  await wait(150);
  checks.disconnectReleased = !(await app.request({ action: "probe" })).altHeld;
  await page.getByText("已连接电脑", { exact: true }).waitFor();
  checks.autoReconnect = true;
  await page.reload();
  await page.getByText("已连接电脑", { exact: true }).waitFor();
  checks.tokenReload = true;
  await fixture.request("focus-notepad");
  await wait(100);
  await page.getByRole("button", { name: /输入文字/ }).click();
  const textbox = page.locator("#remote-text");
  await textbox.fill("手机组词发送验证 ABC");
  await textbox.dispatchEvent("compositionstart");
  checks.compositionBlocksSend = await page
    .getByRole("button", { name: "发送文字", exact: true })
    .isDisabled();
  await textbox.dispatchEvent("compositionend", {
    data: "手机组词发送验证 ABC",
  });
  await page.getByRole("button", { name: "发送文字", exact: true }).click();
  await wait(200);
  const finalText = (await fixture.request("read-notepad")).text;
  checks.compositionSendsOnce =
    finalText.split("手机组词发送验证 ABC").length === 2;
  checks.clipboardUnchanged =
    clipboardBefore === (await fixture.request("clipboard-sequence"));
  await page.screenshot({
    path: "output/playwright/tauri-mobile.png",
    fullPage: true,
  });
  await app.request({ action: "revoke" });
  await page.getByRole("button", { name: "配对连接", exact: true }).waitFor();
  checks.revocationReturnedToPairing = true;
  await app.request({ action: "stop" });
  checks.stoppedPortClosed = await fetch(ready.origin).then(
    () => false,
    () => true,
  );
  const restarted = await app.request({ action: "start" });
  checks.restartServesEmbeddedPage = (
    await fetch(restarted.origin).then((r) => r.text())
  ).includes("枕控 PillowControl");
  checks.noBrowserErrors = errors.length === 0;
  details.browserErrors = errors;
  details.checks = checks;
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/tauri-windows-verification.json",
    JSON.stringify(details, null, 2),
  );
  for (const [name, ok] of Object.entries(checks)) assert(ok, name);
  console.log(
    JSON.stringify(
      { checks, report: "artifacts/tauri-windows-verification.json" },
      null,
      2,
    ),
  );
} finally {
  if (before)
    await app
      .request({ action: "restore-volume", value: before.volume })
      .catch(() => {});
  if (fixture) {
    await fixture.request("close").catch(() => {});
    fixture.child.stdin.end();
  }
  if (browser) await browser.close();
  await app.request({ action: "quit" }).catch(() => {});
  app.child.stdin.end();
}
