// Disposable signing smoke test. Never changes production keys/configuration.
import { mkdtemp, copyFile, readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { metadata, assertMetadata, names } from "./update-release-lib.mjs";
const version = JSON.parse(await readFile("package.json","utf8")).version;
const dir = await mkdtemp(join(tmpdir(),"pillow-signing-test-"));
const privatePath = join(dir,"disposable.key"), publicPath = privatePath+".pub";
const setup = join(dir,names(version).setup);
const env = {...process.env};
delete env.TAURI_SIGNING_PRIVATE_KEY;
delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "";
// Capture output internally: generate may print secret material. Never log it,
// even on errors, and never propagate an Error containing stdout/stderr.
const cli = args => {
  const result = spawnSync(process.execPath,["node_modules/@tauri-apps/cli/tauri.js",...args],
    {env,stdio:"pipe",timeout:120000});
  if(result.error || result.status!==0) throw Error("Tauri signing test failed; sensitive tool output was suppressed.");
};
const verify = file => spawnSync(join(process.env.USERPROFILE,".cargo/bin/cargo.exe"),
  ["run","--locked","--manifest-path",resolve("src-tauri/Cargo.toml"),"--example","verify_update","--",
    file,setup+".sig",publicPath],{stdio:"pipe",timeout:120000});
try {
  cli(["signer","generate","--ci","-w",privatePath]);
  await copyFile(resolve("release",names(version).setup),setup);
  cli(["signer","sign","-f",privatePath,setup]);
  const good = verify(setup);
  assert.equal(good.status,0,"Generated installer signature did not verify (tool output suppressed)");
  const bytes = await readFile(setup); bytes[bytes.length-1] ^= 1;
  const modified = join(dir,"modified-setup.exe");await writeFile(modified,bytes);
  assert.equal(verify(modified).status,1,"Tampered installer must be rejected by verification, not a crash");
  const signature = (await readFile(setup+".sig","utf8")).trim();
  const manifest = metadata(version,signature,"Local signing test only; not a published update.");
  assertMetadata(manifest,version,signature);
  await writeFile(join(dir,"latest.json"),JSON.stringify(manifest,null,2));
  await mkdir("output/playwright/updates",{recursive:true});
  await writeFile("output/playwright/updates/signing-results.json",JSON.stringify({
    realInstallerSigned:true,validSignatureAccepted:true,tamperedInstallerRejected:true,
    manifestValidated:true,productionKeyConfigured:false,published:false,
  },null,2));
  console.log("Actual installer signing, verification, tamper rejection and metadata passed. Nothing published.");
} finally {
  // One explicitly scoped generated private file; no directory or batch deletion.
  await unlink(privatePath).catch(e=>{if(e.code!=="ENOENT")throw Error("Remove the disposable key manually: "+privatePath);});
}
