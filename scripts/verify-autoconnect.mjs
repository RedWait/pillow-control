// Real Windows restart/autostart acceptance, without rebooting Windows or sending input.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir, copyFile, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dir=resolve('artifacts/auto start test');await mkdir(dir,{recursive:true});
const exe=join(dir,'pillow-control.exe');await copyFile('src-tauri/target/release/pillow-control.exe',exe);
const prefs=join(process.env.LOCALAPPDATA,'org.pillowcontrol.desktop','preferences.json');
const backup=await readFile(prefs).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const regScript=resolve('scripts/verify-startup-registry.ps1');
const reg=(mode)=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',regScript,'-Mode',mode,'-BackupPath',join(dir,'registry-backup.json')],{encoding:'utf8'}));
reg('backup');
const port=19334;
let processApp, exitApp, desktopBrowser, desktopPage, mobileBrowser;
const checks={};
const invoke=(command,args={})=>desktopPage.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const native=()=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/verify-window.ps1'),'-TargetProcessId',String(processApp.pid),'-Action','state'],{encoding:'utf8'}));
async function start(args=[]) {
 processApp=spawn(exe,args,{windowsHide:true,cwd:process.env.TEMP,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port}`}});exitApp=once(processApp,'exit');
 for(let i=0;i<100;i++){if(await fetch(`http://127.0.0.1:${port}/json/version`).then(r=>r.ok,()=>false))break;await wait(150);}
 desktopBrowser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
 for(let i=0;i<100;i++){desktopPage=desktopBrowser.contexts()[0].pages()[0];if(desktopPage && await desktopPage.evaluate(()=>!!window.__TAURI_INTERNALS__).catch(()=>false))break;await wait(100);}
 for(let i=0;i<100;i++){if((await invoke('desktop_state')).running)break;await wait(100);}
}
async function quit(){await invoke('desktop_action',{action:'quit'}).catch(()=>{});await exitApp;await desktopBrowser?.close().catch(()=>{});desktopBrowser=null;processApp=null;await wait(250);}
try {
 // Test-specific initial state, preserving the exact pre-test file for restoration.
 await mkdir(join(process.env.LOCALAPPDATA,'org.pillowcontrol.desktop'),{recursive:true});
 await writeFile(prefs,JSON.stringify({token_digest:null,autostart:null,address:''}));
 reg('clear');
 await start();
 assert.ok(native().visible); checks.manualLaunchShowsWindow=true;
 const state=await invoke('desktop_state');const origin=`http://${state.selected}:${state.port}`;
 mobileBrowser=await chromium.launch({channel:'chrome',headless:true});
 const mobile=await mobileBrowser.newPage({viewport:{width:390,height:650},isMobile:true,hasTouch:true});
 await mobile.goto(origin);await mobile.locator('#pair-code').fill(state.code);await mobile.getByRole('button',{name:'配对连接',exact:true}).click();await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor();
 for(let i=0;i<30;i++){if((await invoke('desktop_state')).autostart)break;await wait(150);}
 assert.ok((await invoke('desktop_state')).autostart);
 assert.equal(reg('read').run,`"${exe}" --autostart`);checks.firstPairEnablesQuotedStartupPath=true;
 const token=await mobile.evaluate(()=>localStorage.getItem('pillow-token'));
 const stored=JSON.parse(await readFile(prefs,'utf8'));assert.ok(stored.token_digest?.length===64 && stored.autostart===true);
 assert.ok(!(await readFile(prefs,'utf8')).includes(token));checks.onlyDigestStored=true;
 await desktopPage.screenshot({path:join(dir,'desktop-settings.png'),fullPage:true});
 await quit();
 await start(['--autostart']);
 assert.equal(native().visible,false);checks.autostartWindowHidden=true;
 await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor({timeout:15000});
 assert.equal(await mobile.evaluate(()=>localStorage.getItem('pillow-token')),token);checks.restartBrowserAutoConnect=true;
 // A repeated login-start request must not surface the existing window.
 const silentSecond=spawn(exe,['--autostart'],{windowsHide:true});await once(silentSecond,'exit');assert.equal(native().visible,false);checks.duplicateSilentStartStaysHidden=true;
 const manualSecond=spawn(exe,[],{windowsHide:true});await once(manualSecond,'exit');await wait(250);assert.ok(native().visible);checks.manualSecondStartRestoresWindow=true;
 await invoke('desktop_action',{action:'stop'});await wait(5500);assert.equal((await invoke('desktop_state')).running,false);checks.explicitStopDoesNotRestart=true;
 await invoke('desktop_action',{action:'start'});await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor({timeout:15000});checks.stopStartKeepsTrust=true;
 await invoke('desktop_action',{action:'autostartoff'});assert.equal(reg('read').run,null);checks.disableRemovesStartup=true;
 await invoke('desktop_action',{action:'disconnect'});await mobile.getByRole('button',{name:'配对连接',exact:true}).waitFor();
 await quit();await start(['--autostart']);assert.equal((await invoke('desktop_state')).trusted,false);assert.equal(reg('read').run,null);checks.revocationAndOptOutSurviveRestart=true;
 const newState=await invoke('desktop_state');await mobile.locator('#pair-code').fill(newState.code);await mobile.getByRole('button',{name:'配对连接',exact:true}).click();await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor();await wait(1200);assert.equal(reg('read').run,null);checks.rePairDoesNotOverrideOptOut=true;
 await quit();
 await writeFile('artifacts/autoconnect-results.json',JSON.stringify({checks,scope:'Actual Windows registry, Tauri EXE process restart and Chromium browser; not an OS reboot or physical phone test'},null,2));console.log(JSON.stringify(checks,null,2));
} finally {
 if(processApp)await quit().catch(()=>{processApp?.kill();});
 await mobileBrowser?.close();
 if(backup!==null)await writeFile(prefs,backup);else await unlink(prefs).catch(e=>{if(e.code!=='ENOENT')throw e;});
 reg('restore');
}
