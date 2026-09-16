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
  await page.locator("#pair-code").fill(ready.code);
  await page.getByRole("button", { name: "配对连接", exact: true }).click();
  await page.getByText("已连接", { exact: true }).waitFor();
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
  await send({type:"move",dx:2,dy:0});
  await wait(80);
  let halo = await fixture.request("halo");
  checks.haloFollowsPhysicalCursor = halo.visible && Math.abs(halo.left+halo.width/2-halo.x)<=1 && Math.abs(halo.top+halo.height/2-halo.y)<=1;
  details.haloInspection={...halo,beforeForeground:from.foreground};
  checks.haloTransparentAndNonActivating = halo.hit!==halo.hwnd && halo.strokeHit!==halo.hwnd && halo.foreground===from.foreground && (halo.style & 0x080800a0)===0x080800a0;
  details.haloScreenshot=await fixture.request("halo-screenshot");
  details.screens=await fixture.request("screens");
  details.haloGeometry=(await app.request({action:"probe"})).halo;
  const moved = await app.request({ action: "probe" });
  checks.realCursorMoved = moved.x !== from.x || moved.y !== from.y;
  await send({ type: "click", button: "left", count: 1 });
  await wait(120);
  checks.realClick = (await fixture.request("clicks")) === 1;
  checks.haloClickPassesThrough = checks.realClick && (await fixture.request("halo")).visible;
  await send({type:"move",dx:2,dy:0});
  await wait(1110);
  const fading=(await app.request({action:"probe"})).halo;
  checks.haloFades = fading.alpha>0 && fading.alpha<255;
  await wait(220);
  checks.haloHidesWhenIdle = !(await fixture.request("halo")).visible;
  await fixture.request("local-move"); await wait(120);
  checks.localMovementDoesNotTriggerHalo = !(await fixture.request("halo")).visible;
  for(const mode of ["maximize","borderless"]) {
    await fixture.request(mode); await send({type:"move",dx:2,dy:0});await wait(80);
    checks[`haloOver${mode}`]=(await fixture.request("halo")).visible;
  }
  await fixture.request("normal");
  await app.request({action:"halo-settings",value:{enabled:true,size:"large"}});
  await send({type:"move",dx:2,dy:0});await wait(80);
  const large=(await app.request({action:"probe"})).halo;
  checks.haloSizeUpdates = large.diameter===Math.round(112*large.dpi/96);
  await app.request({action:"halo-settings",value:{enabled:false,size:"large"}});await wait(80);
  checks.haloDisableCleansWindow = !(await fixture.request("halo")).exists;
  await app.request({action:"halo-settings",value:{enabled:true,size:"medium"}});await wait(80);
  checks.haloEnableNeedsRemoteMovement = !(await fixture.request("halo")).visible;
  await fixture.request("edge");await send({type:"move",dx:-1,dy:0});await wait(80);
  const edgeHalo=await fixture.request("halo");
  checks.haloAtScreenEdge=edgeHalo.visible && edgeHalo.left<0 && edgeHalo.top<0 && Math.abs(edgeHalo.left+edgeHalo.width/2-edgeHalo.x)<=1;
  details.haloScreens=[];
  for(let i=0;i<details.screens.length;i++) {
    await fixture.request(`screen-${i}`); await send({type:"move",dx:2,dy:0});await wait(100);
    const native=await fixture.request("halo");const observed=(await app.request({action:"probe"})).halo;
    details.haloScreens.push({screen:details.screens[i],native,observed});
    assert.ok(native.visible && Math.abs(native.left+native.width/2-native.x)<=1 && Math.abs(native.top+native.height/2-native.y)<=1,"Physical halo center on monitor");
    assert.equal(observed.diameter,Math.round(88*observed.dpi/96));
  }
  checks.haloOnAvailableMonitors=true;

  await fixture.request("target-cursor");



  await send({type:"scroll",dy:120});
  await wait(150);
  checks.realWheel = (await fixture.request("wheel")) === -120;
  // Reset the session sequence before switching from diagnostic IDs to normal UI IDs.
  await page.reload();
  await page.getByText("已连接", {exact:true}).waitFor();
  const cdp = await context.newCDPSession(page);
  const pad = await page.locator('.touchpad').boundingBox();
  const touch = (id,y) => ({id,x:pad.x+60+id*45,y:pad.y+50+y});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch(1,0),touch(2,0)]});
  for(let y=6;y<=60;y+=6) {
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[touch(1,y),touch(2,y)]});
    await wait(20);
  }
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await wait(100);
  checks.browserTwoFingerToRealWindowsWheel = (await fixture.request("wheel")) <= -240;

  await send({type:"magnifier",enabled:true});
  await wait(150);
  const lens = await fixture.request("lens");
  checks.realMagnifierWindow = lens.exists && lens.visible && lens.foreground === target.hwnd;
  details.magnifierScreenshot = await fixture.request("lens-screenshot");
  await send({type:"release"});
  checks.gestureReleaseKeepsMagnifier = (await app.request({action:"probe"})).magnifier;
  await wait(1600);
  checks.magnifierHidesWhenIdle = !(await fixture.request("lens")).visible;
  await send({type:"move",dx:20,dy:0}); await wait(100);
  checks.magnifierFollowsMovement = (await fixture.request("lens")).visible;
  await send({type:"magnifier",enabled:false});
  checks.magnifierDestroyed = !(await fixture.request("lens")).exists;
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
  await send({type:"text",text:"X"}); await send({type:"key",key:"backspace"}); await wait(100);
  checks.realBackspace = (await fixture.request("read-notepad")).text === details.notepad.text;
  await send({ type: "volume", action: before.volume > 0.9 ? "down" : "up" });
  const changed = await app.request({ action: "probe" });
  checks.realVolumeChanged = Math.abs(changed.volume - before.volume) > 0.0001;
  await send({ type: "volume", action: "mute" });
  checks.realMuteChanged =
    (await app.request({ action: "probe" })).muted !== before.muted;
  await send({ type: "volume", action: "mute" });
  await app.request({ action: "restore-volume", value: before.volume });
  const switchTarget = await fixture.request("target");
  // SetForegroundWindow may be refused after typing in Notepad. Activate our own target with real input.
  for(let i=0;i<80;i++) {
    const p=await app.request({action:"probe"});const dx=switchTarget.x-p.x,dy=switchTarget.y-p.y;
    if(Math.abs(dx)<8 && Math.abs(dy)<8)break;
    await send({type:"move",dx:Math.max(-50,Math.min(50,Math.round(dx/6))),dy:Math.max(-50,Math.min(50,Math.round(dy/6)))});
  }
  await send({type:"click",button:"left",count:1});await wait(150);
  assert.equal((await app.request({action:"probe"})).foreground,switchTarget.hwnd,"Owned switch target must actually have focus");
  await fixture.request("untop");
  await wait(150);
  const start = await app.request({ action: "probe" });
  await send({ type: "switch", action: "next" });
  await send({ type: "switch", action: "confirm" });
  await wait(250);
  const firstWindow = await app.request({ action: "probe" });
  await send({ type: "switch", action: "next" });
  checks.altHeld = (await app.request({ action: "probe" })).altHeld;
  await wait(180); // Allow the Windows task switcher to open before the next human-paced selection.
  await send({ type: "switch", action: "next" });
  checks.consecutiveSwitchKeepsAlt = (
    await app.request({ action: "probe" })
  ).altHeld;
  await wait(180);
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
  await send({type:"magnifier",enabled:true});
  await send({type:"switch",action:"next"});
  await page.evaluate(() => window.testSocket.close());
  await wait(150);
  checks.disconnectReleased = !(await app.request({ action: "probe" })).altHeld;
  await page.getByText("已连接", { exact: true }).waitFor();
  checks.autoReconnect = true;
  checks.disconnectDestroysMagnifier = !(await fixture.request("lens")).exists;
  checks.disconnectDestroysHalo = !(await fixture.request("halo")).exists;
  await page.reload();
  await page.getByText("已连接", { exact: true }).waitFor();
  checks.tokenReload = true;
  await fixture.request("target");await fixture.request("target-cursor");
  await send({type:"click",button:"left",count:1});await wait(100);
  await fixture.request("untop");
  assert.ok(await fixture.request("focus-notepad"),"Fixture must activate the owned Notepad before text input");
  await page.reload();await page.getByText("已连接",{exact:true}).waitFor();
  await wait(100);
  await page.getByRole("button", { name: /^键盘/ }).click();
  const textbox = page.locator("#remote-text");
  await textbox.fill("手机组词发送验证 ABC");
  await textbox.dispatchEvent("compositionstart");
  checks.compositionBlocksSend = await page
    .getByRole("button", { name: "发送文字", exact: true })
    .isDisabled();
  await textbox.dispatchEvent("compositionend", {
    data: "手机组词发送验证 ABC",
  });
  const textBeforeSend = (await fixture.request("read-notepad")).text;
  await page.getByRole("button", { name: "发送文字", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#remote-text").value === "");
  await wait(300);
  const finalText = (await fixture.request("read-notepad")).text;
  checks.compositionSendsOnce =
    finalText.split("手机组词发送验证 ABC").length - textBeforeSend.split("手机组词发送验证 ABC").length === 1;
  checks.clipboardUnchanged =
    clipboardBefore === (await fixture.request("clipboard-sequence"));
  await page.screenshot({
    path: "output/playwright/tauri-mobile.png",
    fullPage: true,
  });
  await app.request({ action: "revoke" });
  await page.getByRole("button", { name: "配对连接", exact: true }).waitFor();
  checks.revocationReturnedToPairing = true;
  const repaired=await app.request({action:"state"});
  await page.locator("#pair-code").fill(repaired.code);
  await page.getByRole("button",{name:"配对连接",exact:true}).click();
  await page.getByText("已连接",{exact:true}).waitFor();
  await send({type:"move",dx:2,dy:0});await wait(80);
  assert.ok((await fixture.request("halo")).visible,"Halo must be active before stopping the service");
  await app.request({ action: "stop" });await wait(80);
  checks.stopDestroysHalo = !(await fixture.request("halo")).exists;
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
