<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import { Copy, ChevronDown, PanelBottomClose } from "@lucide/vue";
import QRCode from "qrcode";
import logo from "../../shared/assets/logo-ui.png";
import type { DesktopState } from "../../shared/protocol";
import "./style.css";
import {desktop} from './bridge';
const state = ref<DesktopState>({
  running: false,
  autostart: false,
  trusted: false,
  connected: false,
  code: "",
  codeRemaining: 0,
  addresses: [],
  selected: "",
  port: 19827,
  error: "",
});
const selected = ref("");
const qr = ref("");
const busy = ref(false);
const showPairing = ref(false);
const copyMessage = ref("");
const title = computed(() => !state.value.running ? "遥控已停止" : state.value.connected ? "手机已连接" : state.value.trusted ? "已配对 · 手机离线" : "等待手机配对");
const description = computed(() => !state.value.running ? "启动遥控后，手机才能连接。已保存的配对会保留。" : state.value.connected ? "遥控已就绪，可以让枕控留在后台。" : state.value.trusted ? "配对已保留，手机打开原网址即可重新连接。" : "手机与电脑连接同一路由器，扫码后输入配对码。");
const codeStatus = computed(() => state.value.codeRemaining > 0 ? `有效 · 剩余 ${Math.ceil(state.value.codeRemaining / 60)} 分钟` : "配对码已过期，请重新配对");
async function copyAddress() {
  try { await navigator.clipboard.writeText(url.value); copyMessage.value = "地址已复制"; }
  catch { copyMessage.value = "复制失败，请选中地址手动复制"; }
}
let unsubscribe = () => {};
const url = computed(() =>
  state.value.selected
    ? `http://${state.value.selected}:${state.value.port}`
    : "",
);
watch([url, () => state.value.running], async () => {
  qr.value = state.value.running
    ? await QRCode.toDataURL(url.value, {
        width: 200,
        margin: 2,
        color: { dark: "#191b1a", light: "#ffffff" },
      })
    : "";
});
function update(value: DesktopState) {
  state.value = value;
  if (
    !selected.value ||
    !value.addresses.some((a) => a.address === selected.value)
  )
    selected.value = value.selected;
}
async function action(name: string) {
  busy.value = true;
  try {
    const value = await desktop.action(name, selected.value);
    if (value) update(value);
  } catch (e) {
    state.value.error = String(e);
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  update(await desktop.state());
  unsubscribe = desktop.subscribe(update);
});
onUnmounted(() => unsubscribe());
</script>
<template>
  <main>
    <header class="brand-header"><img class="brand-icon" :src="logo" alt="" /><h1>枕控 <span>PillowControl</span></h1><span class="version">v0.2.1</span></header>
    <section class="status" :class="{ connected: state.connected && state.running }" aria-live="polite">
      <div class="status-heading"><span class="dot" :class="{ live: state.running }"></span><h2>{{ title }}</h2></div>
      <p>{{ description }}</p>
      <button v-if="state.connected && state.running" class="accent background-button" :disabled="busy" @click="action('hide')"><PanelBottomClose aria-hidden="true" />后台运行</button>
      <button v-if="!state.running" class="accent" :disabled="busy" @click="action('start')">启动遥控</button>
    </section>
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
    <button v-if="state.running && state.trusted" class="pair-toggle" :aria-expanded="showPairing" @click="showPairing = !showPairing">扫码与配对信息<ChevronDown aria-hidden="true" :class="{ rotated: showPairing }" /></button>
    <section v-if="state.running && (!state.trusted || showPairing)" class="connection-grid">
      <div class="qr-card"><img v-if="qr" :src="qr" alt="用手机相机扫描此二维码连接电脑" /><p>用手机相机扫码</p></div>
      <div class="pair-details"><h3>6 位配对码</h3><div class="pair-code" :class="{ expired: state.codeRemaining <= 0 }">{{ state.code }}</div><p class="code-status">{{ codeStatus }}</p><button class="text-button" :disabled="busy" @click="action('pair')">重新配对</button><p class="hint">重新配对会撤销旧手机凭证。</p></div>
    </section>
    <section class="address-row"><div><p class="hint">当前连接地址{{ state.running ? '' : '（服务已停止）' }}</p><code>{{ url || "暂无可用局域网地址" }}</code></div><button :disabled="!url" @click="copyAddress"><Copy aria-hidden="true" />复制地址</button></section>
    <p v-if="copyMessage" class="copy-feedback" role="status">{{ copyMessage }}</p>
    <details class="settings"><summary>连接设置<ChevronDown aria-hidden="true" /></summary><div class="details-body"><label for="network">局域网网卡</label><select id="network" v-model="selected" :disabled="state.running || busy"><option value="" disabled>请选择局域网网卡</option><option v-for="item in state.addresses" :key="item.address" :value="item.address">{{ item.name }} · {{ item.address }}{{ item.virtual ? '（虚拟 / VPN）' : '' }}</option></select><p class="hint">更换网卡请先停止遥控，再选择并启动。</p></div></details>
    <label class="startup-setting"><span>登录 Windows 后自动启动<small>启动后留在托盘</small></span><input type="checkbox" :checked="state.autostart" :disabled="busy" @change="action(state.autostart ? 'autostartoff' : 'autostarton')" /></label>
    <details class="help"><summary>连接不上？<ChevronDown aria-hidden="true" /></summary><div class="details-body"><p>手机连接家庭 Wi-Fi，电脑连接同一路由器；电脑可使用网线。访客网络 / AP 隔离可能阻止互访。</p><p>Windows 防火墙仅允许「专用网络」，必要时添加本程序 TCP 19827 专用网络入站许可。</p><p>多网卡优先选择真实以太网 / Wi-Fi；VPN、虚拟网卡或地址变化后请先停止遥控，再选择网卡。</p><p>只在可信局域网使用，HTTP 未加密。锁屏、UAC 和管理员窗口不支持遥控。</p></div></details>
    <footer><span>关闭窗口后继续在托盘运行</span><div><button v-if="state.running" :disabled="busy" @click="action('stop')">停止遥控</button><button :disabled="!state.trusted || busy" @click="action('disconnect')">撤销手机</button><button :disabled="busy" @click="action('quit')">退出程序</button></div></footer>
  </main>
</template>
