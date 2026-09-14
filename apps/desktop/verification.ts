import { BrowserWindow, app } from "electron";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { RemoteServer } from "./server";
import type { WindowsController } from "./windows";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
export async function runVerification(
  controller: WindowsController,
  exe: string,
) {
  const root = path.join(app.getPath("temp"), "pillow-control-verification");
  await mkdir(root, { recursive: true });
  await writeFile(
    path.join(root, "index.html"),
    "<!doctype html><title>枕控链路验证</title>",
  );
  const server = new RemoteServer(root, controller);
  await server.start("127.0.0.1", 0);
  const browser = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  try {
    await browser.loadURL(server.address);
    await browser.webContents.executeJavaScript(
      `(async()=>{const r=await fetch('/api/pair',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:${JSON.stringify(server.pairing.code)}})});const {token}=await r.json();window.ws=new WebSocket(location.origin.replace('http:','ws:')+'/ws');window.sequence=0;window.pending=new Map();await new Promise((resolve,reject)=>{ws.onopen=()=>ws.send(JSON.stringify({kind:'auth',token}));ws.onmessage=e=>{const data=JSON.parse(e.data);if(data.kind==='ready')resolve();else if(data.kind==='ack'){const p=pending.get(data.id);pending.delete(data.id);data.error?p?.reject(new Error(data.error)):p?.resolve();}};ws.onerror=reject;});window.sendCommand=command=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});ws.send(JSON.stringify({kind:'command',id,command}));});window.ping=setInterval(()=>ws.send(JSON.stringify({kind:'ping'})),1000);})()`,
    );
    const send = async (command: object) =>
      browser.webContents.executeJavaScript(
        `sendCommand(${JSON.stringify(command)})`,
      );
    const fixturePath =
      process.env.PILLOW_VERIFY_FIXTURE ||
      path.join(app.getAppPath(), "artifacts", "VerificationHost.exe");
    const fixture = spawn(fixturePath, [], { windowsHide: true });
    const responses = createInterface({ input: fixture.stdout });
    const fixtureRequest = (command: string): Promise<any> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error("Verification fixture timeout")),
          8000,
        );
        responses.once("line", (line) => {
          clearTimeout(timer);
          const reply = JSON.parse(line);
          reply.ok ? resolve(reply.result) : reject(new Error(reply.error));
        });
        fixture.stdin.write(command + "\n");
      });
    fixture.on("error", () => {});
    const before: any = await controller.request({ type: "probe" });
    const target = await fixtureRequest("target");
    await new Promise((r) => setTimeout(r, 250));
    // Relative motion under Windows acceleration: approach target using actual cursor feedback.
    for (let i = 0; i < 70; i++) {
      const p: any = await controller.request({ type: "probe" });
      const dx = target.x - p.x,
        dy = target.y - p.y;
      if (Math.abs(dx) < 8 && Math.abs(dy) < 8) break;
      await send({
        type: "move",
        dx: Math.max(-50, Math.min(50, Math.round(dx / 6))),
        dy: Math.max(-50, Math.min(50, Math.round(dy / 6))),
      });
    }
    await send({ type: "click", button: "left", count: 1 });
    await new Promise((r) => setTimeout(r, 100));
    const clicks = await fixtureRequest("clicks");
    const notepadFile: string = await fixtureRequest("notepad");
    await new Promise((r) => setTimeout(r, 1800));
    const notepadBefore = await fixtureRequest("read-notepad");
    if (
      !/Notepad|记事本/i.test(notepadBefore.name) ||
      !notepadBefore.name.includes(path.basename(notepadFile))
    ) {
      console.error("Notepad diagnostic", JSON.stringify(notepadBefore));
      await fixtureRequest("close");
      throw new Error("Notepad did not gain focus; no text sent");
    }
    const sample = "枕控中文输入验证 PillowControl 123";
    await send({ type: "text", text: sample });
    await new Promise((r) => setTimeout(r, 400));
    const notepad = await fixtureRequest("read-notepad");
    await fixtureRequest("target");
    await fixtureRequest("untop");
    await new Promise((r) => setTimeout(r, 200));
    const moveFrom: any = await controller.request({ type: "probe" });
    await send({ type: "move", dx: 20, dy: 10 });
    const moved: any = await controller.request({ type: "probe" });
    await send({ type: "volume", action: before.volume > 0.9 ? "down" : "up" });
    const volume: any = await controller.request({ type: "probe" });
    await controller.request({ type: "restore-volume", value: before.volume });
    await send({ type: "switch", action: "next" });
    const held: any = await controller.request({ type: "probe" });
    await send({ type: "switch", action: "next" });
    const heldAgain: any = await controller.request({ type: "probe" });
    await send({ type: "switch", action: "confirm" });
    await new Promise((r) => setTimeout(r, 300));
    const switched: any = await controller.request({ type: "probe" });
    await send({ type: "move", dx: -20, dy: -10 });
    await send({ type: "switch", action: "next" });
    await browser.webContents.executeJavaScript("ws.close()");
    await new Promise((r) => setTimeout(r, 250));
    const released: any = await controller.request({ type: "probe" });
    await fixtureRequest("close");
    fixture.stdin.end();
    const report = {
      at: new Date().toISOString(),
      packaged: app.isPackaged,
      helper: exe,
      before,
      moved,
      moveFrom,
      volume,
      held,
      heldAgain,
      released,
      clicks,
      notepad,
      switched,
      checks: {
        realCursorMoved: moved.x !== moveFrom.x || moved.y !== moveFrom.y,
        realClick: clicks === 1,
        notepadChinese: notepad.text.includes(sample),
        realVolumeChanged: Math.abs(volume.volume - before.volume) > 0.0001,
        altHeld: held.altHeld,
        consecutiveSwitchKeepsAlt: heldAgain.altHeld,
        windowChanged: switched.foreground !== volume.foreground,
        disconnectReleased: !released.altHeld,
      },
      pending: [
        "Physical Android/iPhone LAN, Chinese IME composition and touch gestures",
        "Installer wizard and clean-machine startup",
      ],
    };
    const output =
      process.env.PILLOW_VERIFY_OUTPUT ||
      path.join(app.getAppPath(), "artifacts", "windows-verification.json");
    await mkdir(path.dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify(report, null, 2));
    if (Object.values(report.checks).some((x) => !x))
      throw new Error("Windows verification failed; see " + output);
  } finally {
    browser.destroy();
    await server.stop();
    await controller.close();
  }
}
