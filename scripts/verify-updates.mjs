// Actual local Tauri IPC checks, followed by clearly labelled UI fixture checks.
// Does not install an update or write to GitHub.
import { chromium } from "playwright";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { resolve, join } from "node:path";
import { readFile, writeFile, mkdir, unlink, copyFile } from "node:fs/promises";
import { createServer } from "vite";
import vue from "@vitejs/plugin-vue";
import assert from "node:assert/strict";
const pause = ms => new Promise(r => setTimeout(r, ms));
const out = resolve("output/playwright/updates"); await mkdir(out, { recursive: true });
const prefs = join(process.env.LOCALAPPDATA, "org.pillowcontrol.desktop/preferences.json");
const backup = await readFile(prefs).catch(e => { if (e.code === "ENOENT") return null; throw e; });
const original = backup ? JSON.parse(backup) : {};
const checks = { actual: {}, uiFixtures: {} };
const exe = resolve(process.env.PILLOW_EXECUTABLE || "src-tauri/target/release/pillow-control.exe");
const existing = execFileSync("powershell", ["-NoProfile", "-Command", "(Get-Process pillow-control -ErrorAction SilentlyContinue | Measure-Object).Count"], { encoding: "utf8" }).trim();
if (existing !== "0") throw Error("Close the running PillowControl before this isolated verification; no process was stopped.");
await mkdir("artifacts", { recursive: true });
const registry = mode => execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  resolve("scripts/verify-startup-registry.ps1"), "-Mode", mode, "-BackupPath", resolve("artifacts/update-registry-backup.json")]);
registry("backup");
let child, exited, browser, page, preview, previewBrowser;
const invoke = (command, args = {}) => page.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), { command, args });
async function start(path = exe) {
  child = spawn(path, ["--autostart"], { windowsHide: true, cwd: process.env.TEMP,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=19339" } });
  child.stderr.pipe(process.stderr);
  exited = once(child, "exit");
  for (let i=0;i<100;i++) {
    if (await fetch("http://127.0.0.1:19339/json/version").then(r=>r.ok,()=>false)) break;
    if (child.exitCode !== null) throw Error("App exited before WebView2 attachment");
    await pause(150);
  }
  browser = await chromium.connectOverCDP("http://127.0.0.1:19339");
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(()=>!!window.__TAURI_INTERNALS__);
}
async function stop() {
  if (child) { await invoke("desktop_action",{ action:"quit" }).catch(()=>child.kill()); await exited; child=null; }
  await browser?.close().catch(()=>{}); browser=null;
}
const visible = () => JSON.parse(execFileSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
  resolve("scripts/verify-window.ps1"), "-TargetProcessId", String(child.pid), "-Action", "state"], { encoding:"utf8" })).visible;
try {
  await mkdir(join(process.env.LOCALAPPDATA,"org.pillowcontrol.desktop"),{recursive:true});
  await writeFile(prefs, JSON.stringify({...original, updates:{startup_check:true}}));
  await start();
  assert.equal(visible(),false);
  await pause(3500);
  for (let i=0;i<80 && (await invoke("update_state")).phase==="checking";i++) await pause(250);
  assert.equal(visible(),false); checks.actual.silentStartupNoWindow = true;
  const results = await page.evaluate(()=>Promise.allSettled([
    window.__TAURI_INTERNALS__.invoke("update_action",{action:"check"}),
    window.__TAURI_INTERNALS__.invoke("update_action",{action:"check"}),
  ]));
  assert.equal(results.filter(r=>r.status==="rejected").length,1);
  checks.actual.duplicateCheckRejected = true;
  const checked = await invoke("update_state");
  checks.actual.liveGitHubResult = { phase: checked.phase, error: checked.error, currentVersion: checked.currentVersion };
  assert.ok(["latest","available","error"].includes(checked.phase));
  await page.locator(".software-update summary").click();
  await page.screenshot({path:join(out,"desktop-update-check.png"),fullPage:true});
  await assert.rejects(invoke("plugin:updater|check"));
  checks.actual.rawUpdaterPermissionDenied = true;
  const beforeToggle = JSON.parse(await readFile(prefs,"utf8"));
  await invoke("update_action",{action:"startupoff"});
  const saved = JSON.parse(await readFile(prefs,"utf8"));
  assert.equal(saved.updates.startup_check,false);
  for (const field of ["token_digest","autostart","address","halo"]) {
    if (field in beforeToggle) assert.deepEqual(saved[field],beforeToggle[field]);
  }
  checks.actual.preferenceIsolation = true;
  await stop(); await start(); await pause(3500);
  const restarted = await invoke("update_state");
  assert.equal(restarted.startupCheck,false); assert.equal(restarted.phase,"idle");
  checks.actual.optOutSurvivesRestart = true; await stop();
  const portable = join(out,"portable-fixture"); await mkdir(portable,{recursive:true});
  await copyFile(exe,join(portable,"pillow-control.exe"));
  await writeFile(join(portable,"pillow-portable.json"),'{"distribution":"portable"}');
  await start(join(portable,"pillow-control.exe"));
  assert.equal((await invoke("update_state")).distribution,"portable");
  const refused = await invoke("update_action",{action:"download"});
  assert.equal(refused.phase,"error");
  checks.actual.portableRefusesInAppDownload = true; await stop();

  // Preview fixtures exercise layout/actions only, not OS installation or networking.
  preview = await createServer({configFile:false,root:resolve("apps/desktop-ui"),plugins:[vue()],
    server:{host:"127.0.0.1",port:0}});
  await preview.listen();
  previewBrowser = await chromium.launch({channel:"chrome",headless:true});
  const p = await previewBrowser.newPage({viewport:{width:760,height:680}});
  await p.addInitScript(()=>{
    window.updateCalls=[];
    window.updateFixture={currentVersion:"0.2.1",startupCheck:true,distribution:"installed",phase:"available",
      downloaded:0,total:null,error:"",release:{version:"99.0.0",date:"2026-09-16T00:00:00Z",
      notes:"界面验证数据：修复与改进。不是已发布版本。",canDownload:true,explanation:""}};
    window.__TAURI_INTERNALS__={invoke:async(command,args={})=>{
      if(command==="update_state")return structuredClone(window.updateFixture);
      if(command==="update_action"){
        window.updateCalls.push(args);
        if(args.action==="download"){
          window.updateFixture.phase="downloading";window.updateFixture.total=1000;window.updateFixture.downloaded=500;
          await new Promise(r=>setTimeout(r,1000));window.updateFixture.phase="ready";window.updateFixture.downloaded=1000;
        }
        if(args.action==="later"){window.updateFixture.release=null;window.updateFixture.phase="idle";}
        return structuredClone(window.updateFixture);
      }
      return {running:false,connected:false,trusted:false,code:"012345",codeRemaining:600,
        addresses:[],selected:"192.0.2.10",port:19827,autostart:false,error:"",halo:{enabled:true,size:"medium"}};
    }};
  });
  await p.goto(preview.resolvedUrls.local[0]); await p.locator(".software-update summary").click();
  await p.getByText("枕控 v99.0.0",{exact:true}).waitFor();
  await p.screenshot({path:join(out,"update-available-fixture.png"),fullPage:true});
  await p.getByRole("button",{name:"下载更新",exact:true}).click();
  assert.ok(await p.getByRole("button",{name:"下载更新",exact:true}).isDisabled());
  await p.getByRole("button",{name:"安装更新…",exact:true}).waitFor();
  assert.equal(await p.evaluate(()=>window.updateCalls.filter(a=>a.action==="install").length),0);
  await p.getByRole("button",{name:"安装更新…",exact:true}).click();
  await p.getByRole("button",{name:"确认安装并退出",exact:true}).waitFor();
  await p.screenshot({path:join(out,"update-install-confirm-fixture.png"),fullPage:true});
  await p.getByRole("button",{name:"取消",exact:true}).click();
  assert.equal(await p.evaluate(()=>window.updateCalls.filter(a=>a.action==="install").length),0);
  checks.uiFixtures.installRequiresSeparateConfirmation=true;
  for(const [width,height] of [[760,680],[608,512],[480,420]]) {
    await p.setViewportSize({width,height});
    assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await p.getByRole("button",{name:"打开发布页面",exact:true}).scrollIntoViewIfNeeded();
  }
  checks.uiFixtures.narrowLayoutAccessible=true;
  await p.evaluate(()=>{window.updateFixture.phase="error";window.updateFixture.error="网络不可达（界面验证数据）";window.updateFixture.release=null;});
  await p.getByText("网络不可达（界面验证数据）",{exact:true}).waitFor();
  assert.ok(await p.getByRole("button",{name:"检查更新",exact:true}).isEnabled());
  checks.uiFixtures.failureRetryAvailable=true;
  await writeFile(join(out,"results.json"),JSON.stringify(checks,null,2));
  console.log(JSON.stringify(checks,null,2));
} finally {
  await stop();
  await previewBrowser?.close();await preview?.close();
  if(backup) await writeFile(prefs,backup); else await unlink(prefs).catch(()=>{});
  registry("restore");
}
