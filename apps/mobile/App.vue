<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { Settings2, Volume1, Volume2, VolumeX, ChevronLeft, ChevronRight, Play, Pause, PanelsTopLeft, Keyboard, Ellipsis, Monitor, CornerDownLeft, ArrowUp, ArrowDown, Send, LogOut } from "@lucide/vue";
import BottomSheet from "./BottomSheet.vue";
import logo from "../../shared/assets/logo-ui.png";
import { useConnection } from "./connection";
import { TouchpadGesture, MotionBuffer } from "./gestures";
import type { Command } from "../../shared/protocol";
import "./style.css";
const remote = useConnection();
const { status, message, connectionLabel } = remote;
const online = computed(() => status.value === "connected");
const code = ref("");
const sensitivity = ref(1.5);
const input = ref("");
const composing = ref(false);
const sending = ref(false);
const feedback = ref("");
const switcher = ref(false);
type Panel = "keyboard" | "more" | "settings" | "windows" | "pair";
const panel = ref<Panel | null>(null);
const titles = { keyboard: "键盘", more: "更多操作", settings: "设置", windows: "切换窗口", pair: "连接电脑" };
const textFeedback = ref("");
const pairing = ref(false);
const connectionAddress = location.host;
const touching = ref(false);
let feedbackTimer: ReturnType<typeof setTimeout>;
let tapTimer: ReturnType<typeof setTimeout> | undefined;
let tapAt = 0;
let ticker: ReturnType<typeof setInterval>;
let switchTimer: ReturnType<typeof setTimeout>;
const motion = new MotionBuffer();
function notice(text: string) {
  feedback.value = text;
  clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => (feedback.value = ""), 4500);
}
async function action(command: Command) {
  if (command.type !== "switch") {
    switcher.value = false;
    clearTimeout(switchTimer);
  }
  try {
    await remote.send(command);
  } catch (e) {
    if (online.value && command.type !== "release") notice((e as Error).message);
  }
}
function tap() {
  const now = Date.now();
  if (tapTimer && now - tapAt < 280) {
    clearTimeout(tapTimer);
    tapTimer = undefined;
    void action({ type: "click", button: "left", count: 2 });
  } else {
    tapAt = now;
    tapTimer = setTimeout(() => {
      tapTimer = undefined;
      void action({ type: "click", button: "left", count: 1 });
    }, 280);
  }
}
const gesture = new TouchpadGesture((kind, x, y) => {
  if (!online.value) return;
  if (kind === "move") motion.add(x * sensitivity.value, y * sensitivity.value);
  else if (kind === "scroll")
    motion.scroll = Math.max(-600, Math.min(600, motion.scroll + y * 4));
  else tap();
});
function down(e: PointerEvent) {
  if (!online.value || panel.value || (e.pointerType === "mouse" && e.button !== 0)) return;
  const el = e.currentTarget as HTMLElement;
  el.setPointerCapture(e.pointerId);
  touching.value = true;
  gesture.down(e.pointerId, { x: e.clientX, y: e.clientY }, performance.now());
}
function move(e: PointerEvent) {
  gesture.move(e.pointerId, { x: e.clientX, y: e.clientY });
}
function up(e: PointerEvent) {
  gesture.up(e.pointerId, performance.now());
  touching.value = false;
}
function reset() {
  gesture.cancel();
  motion.clear();
  clearTimeout(tapTimer);
  tapTimer = undefined;
  touching.value = false;
  switcher.value = false;
  clearTimeout(switchTimer);
}
function cancel() {
  reset();
  if (online.value) void action({ type: "release" });
}
function visibility() {
  reset();
  document.hidden ? remote.suspend() : remote.resume();
}
function pagehide() {
  reset();
  remote.suspend();
}
function cycle(actionName: "next" | "previous" | "confirm" | "cancel") {
  switcher.value = actionName === "next" || actionName === "previous";
  clearTimeout(switchTimer);
  void action({ type: "switch", action: actionName });
  if (switcher.value)
    switchTimer = setTimeout(() => {
      switcher.value = false;
      void action({ type: "release" });
      notice("选择已结束，可继续切换窗口");
    }, 3000);
}
async function sendText() {
  if (!online.value || composing.value || sending.value || !input.value) return;
  const value = input.value;
  sending.value = true;
  textFeedback.value = "";
  try {
    await remote.send({ type: "text", text: value });
    if (input.value === value) input.value = "";
    textFeedback.value = "已发送到电脑当前光标位置";
  } catch (e) {
    textFeedback.value = (e as Error).message;
  } finally {
    sending.value = false;
  }
}
function closePanel() {
  if (switcher.value && online.value) void action({ type: "switch", action: "cancel" });
  cancel();
  panel.value = null;
  composing.value = false;
}
function openPanel(name: Panel) {
  cancel();
  feedback.value = "";
  panel.value = name;
  if (name === "windows") cycle("next");
}
function finishSwitch(name: "confirm" | "cancel") {
  cycle(name);
  closePanel();
}
async function pair() {
  if (pairing.value || !/^[0-9]{6}$/.test(code.value) || status.value === "connecting") return;
  pairing.value = true;
  try { await remote.pair(code.value); } finally { pairing.value = false; }
}
function connectionClick() {
  if (status.value === "unpaired") openPanel("pair");
  else if (!online.value) remote.resume();
  else openPanel("settings");
}
watch(online, (connected) => {
  feedback.value = "";
  if (!connected) reset();
  else if (panel.value === "pair") closePanel();
});
watch(status, value => {
  if (value === "unpaired") openPanel("pair");
});
onMounted(() => {
  remote.resume();
  if (status.value === "unpaired") openPanel("pair");
  ticker = setInterval(() => {
    if (!online.value) {
      motion.clear();
      return;
    }
    const { dx, dy, scroll } = motion.drain();
    if (dx || dy) void action({ type: "move", dx, dy });
    if (scroll) void action({ type: "scroll", dy: scroll });
  // About 60 updates/sec, leaving headroom under the server's 100 msg/sec limit.
  // Do not await acknowledgements here: movement must not be paced by network RTT.
  }, 16);
  document.addEventListener("visibilitychange", visibility);
  window.addEventListener("pagehide", pagehide);
  window.addEventListener("pageshow", visibility);
});
onUnmounted(() => {
  reset();
  remote.suspend();
  clearInterval(ticker);
  clearTimeout(feedbackTimer);
  document.removeEventListener("visibilitychange", visibility);
  window.removeEventListener("pagehide", pagehide);
  window.removeEventListener("pageshow", visibility);
});
</script>
<template>
  <main class="remote">
    <header class="topbar">
      <div class="brand"><img class="logo" :src="logo" alt="" /><h1>枕控</h1></div>
      <button class="connection" @click="connectionClick" :aria-label="connectionLabel">
        <span class="dot" :class="{ live: online }" aria-hidden="true"></span>
        <span role="status">{{ connectionLabel }}</span>
      </button>
      <button class="settings-button" aria-label="设置" @click="openPanel('settings')"><Settings2 aria-hidden="true" /><span>设置</span></button>
    </header>
    <p v-if="feedback && !panel" class="operation-feedback" role="status">{{ feedback }}</p>
    <section class="pad-area" aria-label="鼠标操作">
      <div class="touchpad" :class="{ touching, unavailable: !online }" role="application"
        :aria-disabled="!online" aria-label="鼠标触控板，单指移动，点按单击，双击，双指滚动"
        @pointerdown.prevent="down" @pointermove.prevent="move" @pointerup.prevent="up"
        @pointercancel="cancel" @lostpointercapture="gesture.cancel()" @contextmenu.prevent>
        <p>单指移动 <span aria-hidden="true">·</span> 双指滚动</p>
      </div>
      <div class="mouse-buttons">
        <button :disabled="!online" @click="action({ type: 'click', button: 'left', count: 1 })">左键</button>
        <button :disabled="!online" @click="action({ type: 'click', button: 'right', count: 1 })">右键</button>
      </div>
    </section>
    <section class="volume-row" aria-label="音量操作">
      <button :disabled="!online" @click="action({ type: 'volume', action: 'down' })"><Volume1 aria-hidden="true" /><span>音量减</span></button>
      <button :disabled="!online" @click="action({ type: 'volume', action: 'mute' })"><VolumeX aria-hidden="true" /><span>静音</span></button>
      <button :disabled="!online" @click="action({ type: 'volume', action: 'up' })"><Volume2 aria-hidden="true" /><span>音量加</span></button>
    </section>
    <section class="play-row" aria-label="播放快捷键">
      <button :disabled="!online" @click="action({ type: 'key', key: 'left' })"><ChevronLeft aria-hidden="true" /><span>后退</span></button>
      <button class="accent play-button" :disabled="!online" @click="action({ type: 'key', key: 'space' })"><span class="play-icons"><Play aria-hidden="true" /><Pause aria-hidden="true" /></span><span>播放/暂停</span></button>
      <button :disabled="!online" @click="action({ type: 'key', key: 'right' })"><ChevronRight aria-hidden="true" /><span>前进</span></button>
    </section>
    <div class="toolbar" role="group" aria-label="其他操作入口">
      <button :disabled="!online" @click="openPanel('windows')"><PanelsTopLeft aria-hidden="true" /><span>切换窗口</span></button>
      <button :disabled="!online" @click="openPanel('keyboard')"><Keyboard aria-hidden="true" /><span>键盘</span><span v-if="input" class="draft-dot" aria-label="有未发送草稿"></span></button>
      <button :disabled="!online" @click="openPanel('more')"><Ellipsis aria-hidden="true" /><span>更多</span></button>
    </div>
  </main>
  <BottomSheet :open="panel !== null" :title="panel ? titles[panel] : ''" @close="closePanel">
    <form v-if="panel === 'keyboard'" class="text-panel" @submit.prevent="sendText">
      <label for="remote-text">输入到电脑当前光标位置</label>
      <textarea id="remote-text" v-model="input" maxlength="1000" rows="3" data-initial-focus
        placeholder="在这里输入文字…" @compositionstart="composing = true" @compositionend="composing = false"></textarea>
      <div class="text-meta"><span>不读取或修改剪贴板</span><span>{{ input.length }} / 1000</span></div>
      <p v-if="!online" class="panel-feedback" role="status">{{ connectionLabel }}，草稿已保留。</p>
      <p v-if="textFeedback" class="panel-feedback" role="status">{{ textFeedback }}</p>
      <button class="accent send-button" type="submit" :disabled="!online || composing || sending || !input"><Send aria-hidden="true" />{{ sending ? '发送中…' : '发送文字' }}</button>
    </form>
    <div v-else-if="panel === 'more'" class="more-grid">
      <button :disabled="!online" @click="action({ type: 'desktop' })"><Monitor aria-hidden="true" /><span>显示桌面</span></button>
      <button :disabled="!online" @click="action({ type: 'key', key: 'escape' })"><kbd class="esc-key" aria-hidden="true">esc</kbd><span>Esc</span></button>
      <button :disabled="!online" @click="action({ type: 'key', key: 'enter' })"><CornerDownLeft aria-hidden="true" /><span>回车</span></button>
      <button :disabled="!online" @click="action({ type: 'scroll', dy: -120 })"><ArrowUp aria-hidden="true" /><span>向上滚动</span></button>
      <button :disabled="!online" @click="action({ type: 'scroll', dy: 120 })"><ArrowDown aria-hidden="true" /><span>向下滚动</span></button>
    </div>
    <section v-else-if="panel === 'windows'" class="window-panel">
      <p>{{ switcher ? '看着电脑屏幕，连续选择后确认。' : '点击上一个或下一个，继续选择窗口。' }}</p>
      <div class="window-cycle"><button :disabled="!online" @click="cycle('previous')"><ChevronLeft aria-hidden="true" />上一个</button><button :disabled="!online" @click="cycle('next')">下一个<ChevronRight aria-hidden="true" /></button></div>
      <div class="window-cycle"><button :disabled="!online" @click="finishSwitch('cancel')">取消选择</button><button class="accent" :disabled="!online" @click="finishSwitch('confirm')">确认窗口</button></div>
      <small>选择时保持 Alt；停止操作 3 秒自动释放。</small>
    </section>
    <section v-else-if="panel === 'settings'" class="settings-panel">
      <div class="setting-group"><label for="sensitivity">鼠标灵敏度 <b>{{ sensitivity.toFixed(1) }}×</b></label><input id="sensitivity" v-model.number="sensitivity" type="range" min="0.5" max="3" step="0.1" /></div>
      <div class="setting-group"><h3>连接</h3><p>{{ message }}</p><p class="address">{{ connectionAddress }}</p><p>局域网 HTTP 未加密，仅在可信家庭网络使用。</p>
        <button v-if="!online" @click="status === 'unpaired' ? panel = 'pair' : remote.resume()">{{ status === 'unpaired' ? '输入配对码' : '重新连接' }}</button>
        <button v-if="status !== 'unpaired'" @click="remote.forget(); panel = 'pair'"><LogOut aria-hidden="true" />忘记此电脑</button>
      </div>
      <details class="setting-group"><summary>手势与快捷键帮助</summary><p>单指相对滑动移动鼠标；轻点单击，连续轻点两下双击；双指上下滑动滚动页面。左键、右键及备用滚动按钮也可直接操作。</p><p>播放/暂停发送空格，后退、前进发送左右方向键，效果取决于电脑当前窗口与播放器。没有播放状态回传。</p><p>先在电脑上选中输入位置，再发送文字。关闭输入面板会保留草稿；断线后不会重放旧操作。</p><p>连接失败时，检查电脑服务、相同 Wi-Fi / 有线局域网、防火墙及路由器访客网络隔离。</p></details>
    </section>
    <form v-else-if="panel === 'pair'" class="pair-panel" @submit.prevent="pair">
      <label for="pair-code">输入电脑上显示的 6 位配对码</label>
      <input id="pair-code" :value="code" @input="code = ($event.target as HTMLInputElement).value = ($event.target as HTMLInputElement).value.replace(/[^0-9]/g, '').slice(0, 6)" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="off" placeholder="6 位配对码" required data-initial-focus />
      <p role="status">{{ message }}</p><button class="accent" :disabled="pairing || !/^[0-9]{6}$/.test(code) || status === 'connecting'" type="submit">{{ pairing ? '正在配对…' : '配对连接' }}</button>
    </form>
    <p v-if="feedback" class="panel-feedback" role="status">{{ feedback }}</p>
    <p v-if="!online && (panel === 'more' || panel === 'windows')" class="panel-feedback" role="status">{{ connectionLabel }}</p>
  </BottomSheet>
</template>
