// Documentation-only preview. Uses built product assets; never starts the control service.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root=resolve('tauri-dist'), output=resolve('docs/assets');
await mkdir(output,{recursive:true});
const server=createServer(async(req,res)=>{
 const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
 if(!path.startsWith(root+sep)){res.writeHead(403).end();return;}
 try{res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.png':'image/png'})[extname(path)]||'application/octet-stream');res.end(await readFile(path));}catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const desktop=await browser.newPage({viewport:{width:760,height:680},deviceScaleFactor:2});
 await desktop.addInitScript(()=>{window.__TAURI_INTERNALS__={invoke:async()=>({halo:{enabled:true,size:"medium"},running:true,connected:false,trusted:false,autostart:false,code:'123456',codeRemaining:600,addresses:[{name:'演示网络',address:'192.0.2.10',virtual:false}],selected:'192.0.2.10',port:19827,error:''})};});
 await desktop.goto(origin+'/desktop-ui/index.html');await desktop.locator('.qr-card img').waitFor();await desktop.evaluate(()=>document.fonts.ready);
 await desktop.screenshot({path:resolve(output,'desktop-pairing.png')});
 const mobile=await browser.newPage({viewport:{width:390,height:650},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 await mobile.addInitScript(()=>{
  if(location.search.includes('pair')) localStorage.removeItem('pillow-token'); else localStorage.setItem('pillow-token','a'.repeat(64));
  class PreviewSocket {
   static OPEN=1;static CLOSING=2;readyState=0;bufferedAmount=0;
   constructor(){setTimeout(()=>{this.readyState=1;this.onopen?.();},20);}
   send(raw){const f=JSON.parse(raw);const data=f.kind==='auth'?{kind:'ready'}:f.kind==='ping'?{kind:'pong'}:{kind:'ack',id:f.id};setTimeout(()=>this.onmessage?.({data:JSON.stringify(data)}),0);}
   close(){this.readyState=3;this.onclose?.({code:1000});}
  }
  window.WebSocket=PreviewSocket;
 });
 await mobile.goto(origin+'/mobile/index.html');await mobile.getByRole('button',{name:'已连接',exact:true}).waitFor();
 const screenshot=async name=>{await mobile.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await mobile.screenshot({path:resolve(output,name)});};
 await screenshot('mobile-remote.png');await mobile.getByRole('button',{name:'更多',exact:true}).click();await screenshot('mobile-more.png');
 await mobile.getByRole('button',{name:'关闭',exact:true}).click();await mobile.getByRole('button',{name:'设置',exact:true}).click();await mobile.getByRole('button',{name:'忘记此电脑'}).click();await mobile.goto(origin+'/mobile/index.html?pair');await mobile.locator('#pair-code').waitFor();await screenshot('mobile-pairing.png');
 console.log('Captured current UI with documentation-only state; address 192.0.2.10 and code 123456.');
}finally{await browser.close();await new Promise(r=>server.close(r));}
