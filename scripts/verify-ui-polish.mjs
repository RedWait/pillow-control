import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import assert from 'node:assert/strict';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const dir=resolve('output/playwright/ui-polish');await mkdir(dir,{recursive:true});
const prefs=join(process.env.LOCALAPPDATA,'org.pillowcontrol.desktop','preferences.json');
const backup=await readFile(prefs).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
const reg=mode=>JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/verify-startup-registry.ps1'),'-Mode',mode,'-BackupPath',resolve('artifacts/ui-polish-registry-backup.json')],{encoding:'utf8'}));
reg('backup');
let app, exited, desktopBrowser, mobileBrowser, desktopPage;
const checks={};
const invoke=(command,args={})=>desktopPage.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
const shot=async(page,name)=>{await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:join(dir,name+'.png'),fullPage:true});};
try {
 await mkdir(join(process.env.LOCALAPPDATA,'org.pillowcontrol.desktop'),{recursive:true});
 await writeFile(prefs,JSON.stringify({token_digest:null,autostart:false,address:''}));
 app=spawn(resolve('src-tauri/target/release/pillow-control.exe'),[],{windowsHide:true,cwd:process.env.TEMP,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19335'}});exited=once(app,'exit');
 for(let i=0;i<100;i++){if(await fetch('http://127.0.0.1:19335/json/version').then(r=>r.ok,()=>false))break;await wait(150);}
 desktopBrowser=await chromium.connectOverCDP('http://127.0.0.1:19335');
 for(let i=0;i<100;i++){desktopPage=desktopBrowser.contexts()[0].pages()[0];if(desktopPage && await desktopPage.evaluate(()=>!!window.__TAURI_INTERNALS__).catch(()=>false))break;await wait(100);}
 await desktopPage.getByRole('heading',{name:'等待手机配对'}).waitFor();
 let state=await invoke('desktop_state');assert.ok(state.running && state.codeRemaining>0);checks.realExpiry=true;
 await shot(desktopPage,'desktop-waiting');
 checks.defaultViewport=await desktopPage.evaluate(()=>({width:innerWidth,height:innerHeight,scrollHeight:document.documentElement.scrollHeight}));
 await desktopPage.getByText('遥控设置',{exact:true}).click();
 assert.deepEqual((await invoke('desktop_state')).halo,{enabled:true,size:'medium'});
 await desktopPage.locator('#halo-size').selectOption('large');
 await desktopPage.getByRole('checkbox',{name:/鼠标定位光环/}).uncheck();
 await desktopPage.waitForFunction(()=>!document.querySelector('input[type=checkbox]').checked);
 state=await invoke('desktop_state');assert.deepEqual(state.halo,{enabled:false,size:'large'});
 const savedHalo=JSON.parse(await readFile(prefs,'utf8'));assert.deepEqual(savedHalo.halo,state.halo);assert.equal(savedHalo.autostart,false);
 checks.haloSettingsSaved=true;await shot(desktopPage,'desktop-halo-settings');
 await desktopPage.getByText('遥控设置',{exact:true}).click();
 await desktopPage.getByText('连接设置',{exact:true}).click();assert.ok(await desktopPage.locator('#network').isDisabled());await shot(desktopPage,'desktop-settings');
 await desktopPage.getByText('连接设置',{exact:true}).click();
 await desktopPage.getByRole('button',{name:'复制地址'}).click();await desktopPage.getByRole('status').filter({hasText:/地址已复制|复制失败/}).waitFor();checks.copyFeedback=true;
 const origin=`http://${state.selected}:${state.port}`;
 mobileBrowser=await chromium.launch({channel:'chrome',headless:true});
 const mobile=await mobileBrowser.newPage({viewport:{width:390,height:650},isMobile:true,hasTouch:true});
 await mobile.goto(origin);await mobile.locator('#pair-code').waitFor();
 assert.equal(await mobile.locator('#pair-code').getAttribute('inputmode'),'numeric');
 assert.ok(await mobile.getByRole('button',{name:'配对连接'}).isDisabled());
 assert.ok(!(await mobile.locator('.pair-panel').innerText()).includes('过期'));await shot(mobile,'mobile-pair');
 for(const width of [320,390,430]) {
   await mobile.setViewportSize({width,height:550});
   assert.ok(await mobile.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   assert.ok(await mobile.getByRole('button',{name:'配对连接'}).isVisible());
 }
 await mobile.setViewportSize({width:390,height:650});
 await mobile.evaluate(()=>{
   const viewport=new EventTarget();Object.assign(viewport,{height:310,offsetTop:0,scale:1});
   Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});window.dispatchEvent(new Event('resize'));
 });
 const fieldBox=await mobile.locator('#pair-code').boundingBox();const submitBox=await mobile.getByRole('button',{name:'配对连接'}).boundingBox();
 assert.ok(fieldBox.y>=0 && submitBox.y+submitBox.height<=310);checks.pairKeyboardViewportSimulation=true;
 await shot(mobile,'mobile-pair-keyboard-simulation');
 await mobile.evaluate(()=>{delete window.visualViewport;window.dispatchEvent(new Event('resize'));});
 await mobile.locator('#pair-code').fill('012345');assert.equal(await mobile.locator('#pair-code').inputValue(),'012345');
 await mobile.getByRole('button',{name:'配对连接'}).click();await mobile.getByText('配对码不正确，请核对电脑上显示的 6 位数字').waitFor();checks.realWrongCode=true;
 await mobile.locator('#pair-code').fill(state.code);await mobile.getByRole('button',{name:'配对连接'}).click();await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor();
 await desktopPage.getByRole('heading',{name:'手机已连接'}).waitFor();assert.ok(!await desktopPage.locator('.connection-grid').count());await shot(desktopPage,'desktop-connected');
 await shot(mobile,'mobile-main');await mobile.getByRole('button',{name:'更多',exact:true}).click();await shot(mobile,'mobile-more');
 const boxes=await mobile.locator('.more-grid button').evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,bottom:b.bottom};}));
 assert.equal(boxes[0].y,boxes[2].y);assert.equal(boxes[3].y,boxes[4].y);assert.equal(boxes[3].width,boxes[4].width);assert.ok(boxes[3].y>boxes[2].y);checks.moreRows=true;
 for(const width of [320,390,430]) { await mobile.setViewportSize({width,height:550});const box=await mobile.locator('.sheet-surface').boundingBox();assert.ok(box.x>=0 && box.y>=0 && box.x+box.width<=width && box.y+box.height<=550); }
 checks.pairAndMoreSmallWidths=true;
 await mobile.setViewportSize({width:390,height:650});
 await mobile.getByRole('button',{name:'关闭',exact:true}).click();
 assert.equal(await mobile.evaluate(()=>document.activeElement.textContent),'更多');checks.focusRestored=true;
 // Hide action is a local window operation; service and authenticated session remain alive.
 await desktopPage.getByRole('button',{name:'后台运行'}).click();state=await invoke('desktop_state');assert.ok(state.running && state.connected && state.trusted);checks.hidePreservesSession=true;
 const visible=JSON.parse(execFileSync('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File',resolve('scripts/verify-window.ps1'),'-TargetProcessId',String(app.pid),'-Action','state'],{encoding:'utf8'}));assert.equal(visible.visible,false);checks.nativeHidden=true;
 const second=spawn(resolve('src-tauri/target/release/pillow-control.exe'),[],{windowsHide:true});await once(second,'exit');
 await mobile.close();await desktopPage.getByRole('heading',{name:'已配对 · 手机离线'}).waitFor();await shot(desktopPage,'desktop-offline');checks.trustedOffline=true;
 await desktopPage.getByRole('button',{name:'停止遥控',exact:true}).click();await desktopPage.getByRole('heading',{name:'遥控已停止'}).waitFor();await desktopPage.getByText('连接设置',{exact:true}).click();assert.ok(await desktopPage.locator('#network').isEnabled());await shot(desktopPage,'desktop-stopped');checks.stopKeepsTrust=(await invoke('desktop_state')).trusted;
 // CSS viewport checks only, not actual Windows DPI settings.
 for(const [width,height] of [[760,648],[608,512],[507,420],[480,420]]) {await desktopPage.setViewportSize({width,height});assert.ok(await desktopPage.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await desktopPage.getByRole('button',{name:'退出程序'}).scrollIntoViewIfNeeded();}
 checks.smallViewportAccessible=true;
 await invoke('desktop_action',{action:'quit'}).catch(()=>{});await exited;app=null;
 await desktopBrowser.close().catch(()=>{});
 app=spawn(resolve('src-tauri/target/release/pillow-control.exe'),[],{windowsHide:true,cwd:process.env.TEMP,env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=19335'}});exited=once(app,'exit');
 for(let i=0;i<100;i++){if(await fetch('http://127.0.0.1:19335/json/version').then(r=>r.ok,()=>false))break;await wait(150);}
 desktopBrowser=await chromium.connectOverCDP('http://127.0.0.1:19335');
 for(let i=0;i<100;i++){desktopPage=desktopBrowser.contexts()[0].pages()[0];if(desktopPage && await desktopPage.evaluate(()=>!!window.__TAURI_INTERNALS__).catch(()=>false))break;await wait(100);}
 assert.deepEqual((await invoke('desktop_state')).halo,{enabled:false,size:'large'});checks.haloSettingsSurviveRestart=true;
 await invoke('desktop_action',{action:'quit'}).catch(()=>{});await exited;app=null;
 await writeFile(join(dir,'results.json'),JSON.stringify({scope:'Actual Tauri WebView2 and Rust HTTP/WS; Chromium mobile viewport, not a physical phone or Windows DPI change',checks},null,2));console.log(JSON.stringify(checks,null,2));
} finally {
 if(app){await invoke('desktop_action',{action:'quit'}).catch(()=>app.kill());await exited.catch(()=>{});}
 await mobileBrowser?.close();await desktopBrowser?.close().catch(()=>{});
 if(backup)await writeFile(prefs,backup);else await unlink(prefs).catch(()=>{});
 reg('restore');
}
