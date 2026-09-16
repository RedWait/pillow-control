<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { ChevronDown } from "@lucide/vue";
interface UpdateState {
  currentVersion: string; startupCheck: boolean; distribution: "installed" | "portable" | "unknown";
  phase: string; downloaded: number; total: number | null; error: string;
  release: null | { version: string; date: string; notes: string; canDownload: boolean; explanation: string };
}
const state = ref<UpdateState | null>(null);
const requestBusy = ref(false), confirmInstall = ref(false), transportError = ref("");
const busy = computed(() => requestBusy.value || ["checking", "downloading", "installing"].includes(state.value?.phase || ""));
const status = computed(() => ({
  idle: "", checking: "正在检查更新…", latest: "已是最新版", available: "发现新版本",
  downloading: "正在下载并校验签名…", ready: "下载完成，签名已验证", installing: "正在启动安装程序…", error: state.value?.release?.canDownload ? "下载失败，请重试" : "检查失败，请重试",
} as Record<string, string>)[state.value?.phase || "idle"]);
const version = computed(() => state.value?.currentVersion || "");
const date = computed(() => {
  const value = state.value?.release?.date;
  if (!value) return "发布日期未提供";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "发布日期未提供" : parsed.toLocaleDateString("zh-CN");
});
const progress = computed(() => {
  const s = state.value;
  if (!s) return "";
  const mb = (n: number) => (n / 1024 / 1024).toFixed(1) + " MB";
  return s.total ? mb(s.downloaded) + " / " + mb(s.total) : "已下载 " + mb(s.downloaded);
});
let disposed = false, polling = false;
let timer: ReturnType<typeof setInterval> | undefined;
async function poll() {
  if (polling || disposed) return;
  polling = true;
  try {
    const next = await invoke<UpdateState>("update_state");
    if (!disposed) { state.value = next; transportError.value = ""; }
  } catch { if (!disposed) transportError.value = "无法读取更新状态，请稍后重试"; }
  finally { polling = false; }
}
async function action(action: string, confirmed = false) {
  if (busy.value) return;
  requestBusy.value = true; transportError.value = "";
  try { state.value = await invoke<UpdateState>("update_action", { action, confirmed }); }
  catch (e) { transportError.value = String(e); }
  finally { requestBusy.value = false; confirmInstall.value = false; }
}
onMounted(() => { void poll(); timer = setInterval(poll, 600); });
onUnmounted(() => { disposed = true; clearInterval(timer); });
</script>
<template>
  <details class="settings software-update">
    <summary>软件更新<span v-if="state?.release" class="update-badge">发现 v{{ state.release.version }}</span><ChevronDown aria-hidden="true" /></summary>
    <div class="details-body">
      <div class="update-row"><span>当前版本 {{ version ? 'v' + version : '读取中…' }}<small>{{ state?.distribution === 'installed' ? '安装版' : state?.distribution === 'portable' ? '便携版' : '未确认安装来源 · 手动更新' }}</small></span><button :disabled="busy || !state" @click="action('check')">{{ state?.phase === 'checking' ? '正在检查…' : '检查更新' }}</button></div>
      <label class="startup-setting"><span>启动时检查更新<small>仅检查稳定版，不自动下载或安装</small></span><input type="checkbox" :checked="state?.startupCheck" :disabled="busy || !state" @change="action(state?.startupCheck ? 'startupoff' : 'startupon')" /></label>
      <p v-if="status" role="status">{{ status }}</p>
      <p v-if="transportError || state?.error" class="error" role="status">{{ transportError || state?.error }}</p>
      <section v-if="state?.release" class="update-release">
        <h3>枕控 v{{ state.release.version }}</h3><p class="hint">{{ date }}</p>
        <p class="update-notes">{{ state.release.notes || '此版本未提供更新说明。' }}</p>
        <p v-if="state.release.explanation" class="hint">{{ state.release.explanation }}</p>
        <div v-if="state.phase === 'downloading'"><progress :value="state.total ? state.downloaded : undefined" :max="state.total || 1" aria-label="下载更新进度"></progress><p class="hint">{{ progress }}</p></div>
        <div v-if="confirmInstall" class="install-confirm" role="group" aria-label="确认安装更新">
          <p>安装会暂时中断遥控并退出枕控。配对、设置和自启偏好会保留；安装完成后重新打开枕控。</p>
          <div class="update-actions"><button class="accent" :disabled="busy" @click="action('install', true)">确认安装并退出</button><button :disabled="busy" @click="confirmInstall = false">取消</button></div>
        </div>
        <div v-else class="update-actions">
          <button v-if="state.phase === 'ready'" class="accent" :disabled="busy" @click="confirmInstall = true">安装更新…</button>
          <button v-else-if="state.release.canDownload" class="accent" :disabled="busy" @click="action('download')">下载更新</button>
          <button :disabled="busy" @click="action('later')">稍后</button>
        </div>
      </section>
      <button class="text-button" :disabled="busy" @click="action('openrelease')">打开发布页面</button>
      <p class="hint">更新检查需连接 GitHub；离线不影响局域网遥控。</p>
    </div>
  </details>
</template>
<style scoped>
.update-row,.update-actions { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; }
.update-actions { justify-content:flex-start; margin:12px 0; }
.update-row small { display:block; color:var(--muted,#a3a5a4); margin-top:4px; }
.update-badge { margin-left:auto; color:var(--accent,#b0d9ca); font-size:12px; }
.update-notes { white-space:pre-wrap; overflow-wrap:anywhere; max-height:220px; overflow:auto; line-height:1.6; }
.update-release { border-top:1px solid #363837; padding-top:14px; }
.install-confirm { border-left:2px solid #b0d9ca; padding-left:12px; }
progress { width:100%; accent-color:#b0d9ca; }
</style>
