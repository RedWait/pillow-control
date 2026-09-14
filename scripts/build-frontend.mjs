import { build } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolve } from "node:path";
for (const app of ["mobile", "desktop-ui"]) {
  await build({
    configFile: false,
    root: resolve("apps", app),
    base: "./",
    plugins: [vue()],
    build: { outDir: resolve("tauri-dist", app), emptyOutDir: false },
  });
}
