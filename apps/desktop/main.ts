import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import path from "node:path";
import { WindowsController } from "./windows";
import { RemoteServer } from "./server";
import { addresses, inspectAdapters } from "./network";
import type { DesktopState } from "../../shared/protocol";
import { runVerification } from "./verification";
import { mkdir, writeFile } from "node:fs/promises";
let window: BrowserWindow;
let tray: Tray;
let server: RemoteServer | undefined;
let controller: WindowsController;
let quitting = false;
let error = "";
let selected = "";
let busy = false;
function state(): DesktopState {
  return {
    running: !!server,
    connected: server?.connected || false,
    code: server?.pairing.code || "",
    addresses: addresses(),
    selected,
    port: 19827,
    error,
  };
}
function changed() {
  if (window && !window.isDestroyed())
    window.webContents.send("state", state());
}
async function stop() {
  const old = server;
  server = undefined;
  if (old) await old.stop();
  changed();
}
async function start() {
  if (server) return;
  error = "";
  if (!addresses().some((a) => a.address === selected)) {
    error = "没有可用的局域网 IPv4 地址，请检查网线、Wi-Fi 或选择其他网卡。";
    changed();
    return;
  }
  const next = new RemoteServer(
    path.join(__dirname, "mobile"),
    controller,
    changed,
  );
  try {
    await controller.request({ type: "probe" });
    await next.start(selected, 19827);
    server = next;
  } catch (e) {
    await next.stop();
    const code = (e as NodeJS.ErrnoException).code;
    error =
      code === "EADDRINUSE"
        ? "端口 19827 已被占用，请退出其他枕控实例或占用此端口的程序。"
        : String(e);
  }
  changed();
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const exe = app.isPackaged
      ? path.join(process.resourcesPath, "native", "PillowControl.Helper.exe")
      : path.join(
          app.getAppPath(),
          "native",
          "bin",
          "PillowControl.Helper.exe",
        );
    controller = new WindowsController(exe, (message) => {
      error = message;
      void stop();
    });
    if (process.argv.includes("--verify-windows")) {
      try {
        await runVerification(controller, exe);
        app.exit(0);
      } catch (e) {
        console.error(e);
        app.exit(1);
      }
      return;
    }
    await inspectAdapters();
    selected = addresses().find((a) => !a.virtual)?.address || "";
    window = new BrowserWindow({
      width: 900,
      height: 820,
      minWidth: 680,
      minHeight: 600,
      title: "枕控 PillowControl",
      backgroundColor: "#11151e",
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event) => event.preventDefault());
    window.on("close", (event) => {
      if (!quitting) {
        event.preventDefault();
        window.hide();
      }
    });
    window.on("minimize", () => window.hide());
    ipcMain.handle("state", (event) => {
      if (event.sender !== window.webContents) throw new Error("Forbidden");
      return state();
    });
    ipcMain.handle("action", async (event, action, address) => {
      if (event.sender !== window.webContents || busy) return;
      busy = true;
      try {
        if (action === "start") {
          if (
            typeof address === "string" &&
            addresses().some((a) => a.address === address)
          )
            selected = address;
          await start();
        } else if (action === "stop") await stop();
        else if (action === "disconnect") server?.rotate();
        else if (action === "pair") server?.rotate();
        else if (action === "quit") app.quit();
        changed();
        return state();
      } finally {
        busy = false;
      }
    });
    // Locally generated tray image; no downloaded icons or CDN resources.
    const pixels = Buffer.alloc(32 * 32 * 4);
    for (let y = 0; y < 32; y++)
      for (let x = 0; x < 32; x++) {
        const i = (y * 32 + x) * 4;
        const inner = x > 5 && x < 26 && y > 8 && y < 24;
        pixels[i] = inner ? 207 : 42;
        pixels[i + 1] = inner ? 203 : 30;
        pixels[i + 2] = inner ? 163 : 25;
        pixels[i + 3] = 255;
      }
    tray = new Tray(
      nativeImage.createFromBitmap(pixels, { width: 32, height: 32 }),
    );
    tray.setToolTip("枕控 PillowControl");
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: "打开枕控 PillowControl",
          click: () => {
            window.restore();
            window.show();
          },
        },
        { label: "停止遥控", click: () => void stop() },
        { type: "separator" },
        { label: "退出", click: () => app.quit() },
      ]),
    );
    tray.on("double-click", () => {
      window.restore();
      window.show();
    });
    await window.loadFile(path.join(__dirname, "desktop-ui", "index.html"));
    await start();
    if (process.argv.includes("--capture-ui")) {
      const dir = path.join(process.cwd(), "artifacts");
      await mkdir(dir, { recursive: true });
      await new Promise((r) => setTimeout(r, 600));
      await writeFile(
        path.join(dir, "desktop.png"),
        (await window.webContents.capturePage()).toPNG(),
      );
      await writeFile(path.join(dir, "ui-state.json"), JSON.stringify(state()));
    }
    const networkPoll = setInterval(() => {
      if (server && !addresses().some((a) => a.address === selected)) {
        error = "连接地址已变化，请重新选择网卡并启动遥控。";
        void stop();
      }
      changed();
    }, 5000);
    networkPoll.unref();
  });
  app.on("window-all-closed", () => {});
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    quitting = true;
    void (async () => {
      await stop();
      await controller?.close();
      tray?.destroy();
      app.quit();
    })();
  });
}
