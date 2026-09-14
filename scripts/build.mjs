import { build as bundle } from "esbuild";
import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
import {
  copyFile,
  readFile,
  writeFile,
  readdir,
  mkdir,
  access,
} from "node:fs/promises";
await bundle({
  entryPoints: ["apps/desktop/main.ts", "apps/desktop/preload.ts"],
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
});
for (const app of ["mobile", "desktop-ui"])
  await build({
    configFile: false,
    root: resolve("apps", app),
    base: "./",
    plugins: [vue()],
    build: { outDir: resolve("dist", app), emptyOutDir: false },
  });
const visited = new Set();
let notices = "PillowControl runtime JavaScript dependency licenses\n";
async function license(name) {
  if (visited.has(name)) return;
  visited.add(name);
  const dir = resolve("node_modules", name);
  let pkg;
  try {
    pkg = JSON.parse(await readFile(resolve(dir, "package.json"), "utf8"));
  } catch {
    return;
  }
  notices += `\n\n===== ${pkg.name} ${pkg.version} (${pkg.license || "see package"}) =====\n`;
  for (const file of await readdir(dir))
    if (/^licen[cs]e|^copying|^notice/i.test(file)) {
      try {
        notices += await readFile(resolve(dir, file), "utf8");
      } catch {}
    }
  for (const dependency of Object.keys(pkg.dependencies || {}))
    await license(dependency);
}
for (const name of ["vue", "qrcode", "ws", "zod"]) await license(name);
await writeFile("dist/THIRD_PARTY_LICENSES.txt", notices);
for (const file of ["LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"]) {
  try {
    await access(file);
    await copyFile(file, resolve("dist", file));
  } catch {}
}
await mkdir("dist/docs", { recursive: true });
for (const file of await readdir("docs"))
  await copyFile(resolve("docs", file), resolve("dist/docs", file));
