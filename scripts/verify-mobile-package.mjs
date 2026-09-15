// Release resource and real pairing smoke test. Does not send mouse/text/volume commands.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
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

const version=JSON.parse(await readFile('package.json','utf8')).version;
const executable=resolve(`release/pillow-control-${version}-portable-x64/pillow-control.exe`);
const app=processRpc(executable,['--verify-server'],{cwd:process.env.TEMP,env:{...process.env,Path:process.env.SystemRoot+'\\System32;'+process.env.SystemRoot}});
let browser;
try {
 const ready=await app.next();
 assert.ok(ready.ready);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage({viewport:{width:390,height:650},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 await page.goto(ready.origin);
 await page.locator('#pair-code').fill(ready.code);
 await page.getByRole('button',{name:'配对连接',exact:true}).click();
 await page.getByRole('button',{name:'已连接',exact:true}).waitFor();
 const shot=async name=>{await page.evaluate(()=>Promise.all(document.getAnimations().map(a=>a.finished.catch(()=>{}))));await page.screenshot({path:resolve('artifacts/mobile-ui/package-'+name+'.png')});};
 await shot('main');
 await page.getByRole('button',{name:'键盘',exact:true}).click();
 await page.locator('#remote-text').fill('晚安，明天继续看。');
 await shot('keyboard');
 await page.getByRole('button',{name:'关闭'}).click();
 await page.getByRole('button',{name:'更多',exact:true}).click();
 await shot('more');
 await page.getByRole('button',{name:'关闭'}).click();
 await app.request({action:'revoke'});
 await page.getByRole('button',{name:'配对连接',exact:true}).waitFor();
 assert.deepEqual(errors,[]);
 await writeFile('artifacts/mobile-ui/package-results.json',JSON.stringify({executable,checks:['embedded mobile page','real HTTP pairing','authenticated Rust WebSocket','keyboard and more modal','explicit revoke invalidates credentials'],errors,systemInput:'Only release; mouse/text/volume were not exercised in this UI smoke test'},null,2));
 console.log('Packaged page, pairing, WebSocket and stop lifecycle passed.');
} finally {await browser?.close();await app.request({action:'quit'}).catch(()=>{});app.child.stdin.end();}
