// Browser UI regression using production assets and an explicitly simulated transport.
// No Windows input is executed. Run after npm run build:frontend.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
const root = resolve('tauri-dist/mobile');
const output = resolve('artifacts/mobile-ui');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + (req.url === '/' ? '/index.html' : req.url.split('?')[0]));
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.setHeader('Content-Type', ({'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png'})[extname(path)] || 'application/octet-stream');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    res.end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
try {
  const context = await browser.newContext({ viewport: {width:390,height:650}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
  await context.addInitScript(() => {
    localStorage.setItem('pillow-token', 'a'.repeat(64));
    window.__commands = []; window.__failText = false; window.__networkDown = false;
    class SimulatedSocket {
      static OPEN=1; static CLOSING=2;
      readyState=0; bufferedAmount=0;
      constructor() { window.__socket=this; setTimeout(() => { if (this.readyState !== 0) return; if(window.__networkDown) { this.onerror?.(); this.close(1006); } else { this.readyState=1; this.onopen?.(); } },20); }
      send(raw) {
        const frame=JSON.parse(raw);
        const reply=data=>setTimeout(()=>this.onmessage?.({data:JSON.stringify(data)}), frame.command?.type==='text'?180:0);
        if(frame.kind==='auth') reply({kind:'ready'});
        if(frame.kind==='ping') reply({kind:'pong'});
        if(frame.kind==='command') { window.__commands.push(frame.command); reply({kind:'ack',id:frame.id,...(frame.command.type==='text'&&window.__failText?{error:'测试：电脑拒绝输入，文字未发送'}:{})}); }
      }
      close(code=1000) { this.readyState=3; this.onclose?.({code}); }
    }
    window.WebSocket=SimulatedSocket;
    window.__shrinkViewport = (height, offsetTop=0) => {
      const viewport = new EventTarget();
      Object.assign(viewport, {height,offsetTop,scale:1});
      Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
      window.dispatchEvent(new Event('resize'));
    };
  });
  const page = await context.newPage();
  const screenshot = async options => { await page.evaluate(() => Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{})))); await page.screenshot(options); };
  const errors=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', m=>{ if(m.type()==='error' && !m.text().includes('favicon.ico')) errors.push(m.text()); });
  await page.goto(origin);
  await page.getByRole('button',{name:'已连接',exact:true}).waitFor();
  for (const width of [320,360,375,390,430]) {
    for (const height of [550,650,750]) {
      await page.setViewportSize({width,height});
      const size=await page.evaluate(()=>({scroll:document.documentElement.scrollHeight, height:innerHeight, width:document.documentElement.scrollWidth, pad:document.querySelector('.touchpad').getBoundingClientRect().height, bad:[...document.querySelectorAll('main button')].filter(e=>{const r=e.getBoundingClientRect();return r.width<44||r.height<44||r.bottom>innerHeight;}).map(e=>e.textContent)}));
      assert.ok(size.scroll<=height+1 && size.width<=width && !size.bad.length, JSON.stringify({width,height,...size}));
      assert.ok(size.pad>=132);
      results.push({width,height,padHeight:size.pad,singleScreen:true});
    }
  }
  await page.setViewportSize({width:390,height:650});
  await screenshot({path:resolve(output,'main.png')});
  for (const name of ['音量减','静音','音量加','后退','播放/暂停','前进','左键','右键']) await page.getByRole('button',{name,exact:true}).click();
  const commands=await page.evaluate(()=>window.__commands);
  assert.deepEqual(commands.map(c=>c.type),['volume','volume','volume','key','key','key','click','click']);
  await page.getByRole('button',{name:'键盘',exact:true}).click();
  await page.locator('#remote-text').fill('晚安，明天继续看。');
  await screenshot({path:resolve(output,'keyboard.png')});
  await page.getByRole('button',{name:'关闭'}).click();
  await page.getByRole('button',{name:/键盘/}).click();
  assert.equal(await page.locator('#remote-text').inputValue(),'晚安，明天继续看。');
  await page.locator('#remote-text').dispatchEvent('compositionstart');
  assert.ok(await page.getByRole('button',{name:'发送文字'}).isDisabled());
  await page.locator('#remote-text').dispatchEvent('compositionend');
  await page.getByRole('button',{name:'发送文字'}).click();
  await page.waitForFunction(()=>document.querySelector('#remote-text').value==='');
  assert.equal(await page.evaluate(()=>window.__commands.filter(c=>c.type==='text').length),1);
  await page.locator('#remote-text').fill('失败时保留的草稿');
  await page.evaluate(()=>window.__failText=true);
  await page.getByRole('button',{name:'发送文字'}).click();
  await page.getByText('测试：电脑拒绝输入，文字未发送').waitFor();
  assert.equal(await page.locator('#remote-text').inputValue(),'失败时保留的草稿');
  await page.evaluate(()=>window.__shrinkViewport(330,40));
  const visible=await page.evaluate(()=>{ const send=document.querySelector('.send-button').getBoundingClientRect(); const field=document.querySelector('#remote-text').getBoundingClientRect(); return {send:send.bottom,field:field.top}; });
  assert.ok(visible.send<=370 && visible.field>=40,JSON.stringify(visible));
  await screenshot({path:resolve(output,'keyboard-viewport-simulation.png')});
  await page.getByRole('button',{name:'关闭'}).click();
  await page.evaluate(()=>window.__shrinkViewport(650));
  await page.getByRole('button',{name:'更多',exact:true}).click();
  await screenshot({path:resolve(output,'more.png')});
  for (const name of ['显示桌面','Esc','回车','向上滚动','向下滚动']) await page.getByRole('button',{name,exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>window.__commands.slice(-5)),[{type:'desktop'},{type:'key',key:'escape'},{type:'key',key:'enter'},{type:'scroll',dy:-120},{type:'scroll',dy:120}]);
  for (let i=0;i<9;i++) { await page.keyboard.press('Tab'); assert.ok(await page.evaluate(()=>!document.activeElement.closest('main'))); }
  const beforeBackdrop=await page.evaluate(()=>window.__commands.filter(c=>c.type!=='release').length);
  await page.mouse.click(195,100);
  assert.ok(!await page.locator('dialog').isVisible());
  assert.equal(await page.evaluate(()=>window.__commands.filter(c=>c.type!=='release').length),beforeBackdrop);
  await page.getByRole('button',{name:'切换窗口',exact:true}).click();
  await page.getByRole('button',{name:'下一个',exact:true}).click();
  await page.getByRole('button',{name:'上一个',exact:true}).click();
  await page.getByRole('button',{name:'确认窗口'}).click();
  assert.deepEqual(await page.evaluate(()=>window.__commands.filter(c=>c.type==='switch').map(c=>c.action)),['next','next','previous','confirm']);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await screenshot({path:resolve(output,'settings.png')});
  await page.getByRole('button',{name:'关闭'}).click();
  // Cancel any pending tap before entering a sheet.
  const beforeTap=await page.evaluate(()=>window.__commands.filter(c=>c.type==='click').length);
  await page.locator('.touchpad').tap();
  await page.getByRole('button',{name:'更多',exact:true}).click();
  await page.waitForTimeout(320);
  assert.equal(await page.evaluate(()=>window.__commands.filter(c=>c.type==='click').length),beforeTap);
  await page.getByRole('button',{name:'关闭'}).click();
  // Network loss must disable controls; a failed retry must not masquerade as connected.
  await page.evaluate(()=>{window.__networkDown=true;window.__socket.close(1006);});
  await page.getByRole('button',{name:'连接已断开，正在重连…',exact:true}).waitFor();
  assert.ok(await page.getByRole('button',{name:'左键',exact:true}).isDisabled());
  await page.getByRole('button',{name:'连接失败，点击重试',exact:true}).waitFor();
  await screenshot({path:resolve(output,'offline.png')});
  const beforeReconnect=await page.evaluate(()=>window.__commands.length);
  await page.evaluate(()=>window.__networkDown=false);
  await page.getByRole('button',{name:'连接失败，点击重试',exact:true}).click();
  await page.getByRole('button',{name:'已连接',exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.__commands.length),beforeReconnect);
  await page.setViewportSize({width:750,height:390});
  await screenshot({path:resolve(output,'landscape.png')});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight));
  // Extreme height can scroll, but all controls remain reachable.
  await page.setViewportSize({width:320,height:350});
  await page.getByRole('button',{name:'更多',exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.getByRole('button',{name:'更多',exact:true}).isVisible());
  await page.setViewportSize({width:320,height:550});
  await page.evaluate(()=>{
    const elements=[...document.querySelectorAll('main h1, main button, main p, main button span')];
    const sizes=elements.map(el=>parseFloat(getComputedStyle(el).fontSize)*1.5);
    elements.forEach((el,i)=>el.style.fontSize=sizes[i]+'px');
  });
  await page.getByRole('button',{name:'更多',exact:true}).scrollIntoViewIfNeeded();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await screenshot({path:resolve(output,'large-text.png')});
  assert.deepEqual(errors,[]);
  await writeFile(resolve(output,'results.json'),JSON.stringify({mode:'Chromium mobile emulation; simulated transport and keyboard viewport; not phone hardware acceptance',sizes:results,checks:['control commands','composition guard','draft persistence','ack success/failure','visual viewport shrink','modal backdrop isolation','continuous window switching','disconnect disable','reconnect no replay','landscape','small-height scrolling'],errors},null,2));
  console.log(`Mobile UI checks passed; screenshots: ${output}`);
} finally { await browser.close(); await new Promise(r=>server.close(r)); }
