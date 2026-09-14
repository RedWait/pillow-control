<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useConnection } from "./connection";
import { TouchpadGesture, MotionBuffer } from "./gestures";
import type { Command } from "../../shared/protocol";
import "./style.css";
const remote = useConnection();
const { status, message } = remote;
const online = computed(() => status.value === "connected");
const code = ref("");
const sensitivity = ref(1.5);
const input = ref("");
const composing = ref(false);
const sending = ref(false);
const feedback = ref("");
const switcher = ref(false);
const textOpen = ref(false);
const settings = ref(false);
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
    notice((e as Error).message);
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
  if (e.pointerType === "mouse" && e.button !== 0) return;
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
      notice("窗口选择超时，已释放 Alt");
    }, 3000);
}
async function sendText() {
  if (composing.value || sending.value || !input.value) return;
  const value = input.value;
  sending.value = true;
  try {
    await remote.send({ type: "text", text: value });
    if (input.value === value) input.value = "";
    notice("已发送到电脑当前焦点");
  } catch (e) {
    notice((e as Error).message);
  } finally {
    sending.value = false;
  }
}
watch(online, (connected) => {
  if (!connected) reset();
});
onMounted(() => {
  remote.resume();
  ticker = setInterval(() => {
    if (!online.value) {
      motion.clear();
      return;
    }
    const { dx, dy, scroll } = motion.drain();
    if (dx || dy) void action({ type: "move", dx, dy });
    if (scroll) void action({ type: "scroll", dy: scroll });
  }, 33);
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
      <div class="brand">
        <span class="logo">◒</span>
        <div>
          <h1>枕控 <small>PillowControl</small></h1>
          <p>躺好，电脑交给这里。</p>
        </div>
      </div>
      <button
        class="icon-button"
        aria-label="调整灵敏度和连接"
        @click="settings = !settings"
      >
        ⚙
      </button>
    </header>
    <div class="connection" role="status">
      <span class="dot" :class="{ live: online }"></span
      ><span>{{
        online
          ? "已连接电脑"
          : status === "connecting"
            ? "正在连接…"
            : status === "offline"
              ? "已断线 · 正在等待电脑"
              : "等待配对"
      }}</span
      ><span class="local-tag">仅局域网</span>
    </div>
    <form
      v-if="status === 'unpaired'"
      class="pair-panel"
      @submit.prevent="remote.pair(code)"
    >
      <label for="pair-code">输入电脑上显示的 6 位配对码</label>
      <div class="pair-row">
        <input
          id="pair-code"
          v-model="code"
          inputmode="numeric"
          pattern="[0-9]{6}"
          maxlength="6"
          autocomplete="off"
          placeholder="000000"
          required
        /><button class="accent" type="submit">配对连接</button>
      </div>
      <p>{{ message }}</p>
    </form>
    <div v-else-if="!online" class="warning">
      <p>{{ message }}。请确认电脑端已启动遥控。</p>
      <button @click="remote.resume()">重新连接</button>
    </div>
    <section v-if="settings" class="settings">
      <label for="sensitivity"
        >鼠标灵敏度 <b>{{ sensitivity.toFixed(1) }}×</b></label
      ><input
        id="sensitivity"
        v-model.number="sensitivity"
        type="range"
        min="0.5"
        max="3"
        step="0.1"
      />
      <p>局域网 HTTP 未加密，仅在可信家庭网络使用。</p>
      <button
        @click="
          remote.forget();
          settings = false;
        "
      >
        忘记此电脑
      </button>
    </section>
    <section class="pad-area">
      <div class="section-caption">
        <span>触控板</span><span>单指移动 · 双指滚动</span>
      </div>
      <div
        class="touchpad"
        :class="{ touching, unavailable: !online }"
        role="application"
        aria-label="鼠标触控板，单指移动，点按单击，双击，双指滚动"
        @pointerdown.prevent="down"
        @pointermove.prevent="move"
        @pointerup.prevent="up"
        @pointercancel="cancel"
        @lostpointercapture="gesture.cancel()"
        @contextmenu.prevent
      >
        <div class="pad-center">
          <span class="cursor-icon">⌁</span
          ><strong>{{
            touching ? "轻轻滑动，自在掌控" : "把这里当作触控板"
          }}</strong
          ><span>点按单击 · 连点两下双击</span>
        </div>
        <span class="pad-corner">PILLOW CONTROL</span>
      </div>
      <div class="mouse-buttons">
        <button
          :disabled="!online"
          @click="action({ type: 'click', button: 'left', count: 1 })"
        >
          左键</button
        ><button
          :disabled="!online"
          @click="action({ type: 'click', button: 'right', count: 1 })"
        >
          右键
        </button>
      </div>
    </section>
    <section class="controls" :class="{ unavailable: !online }">
      <div class="section-caption">
        <span>轻松看剧</span><span>快捷键作用于当前窗口</span>
      </div>
      <div class="volume-row">
        <button
          :disabled="!online"
          aria-label="音量减小"
          @click="action({ type: 'volume', action: 'down' })"
        >
          <span>−</span>音量</button
        ><button
          :disabled="!online"
          class="mute"
          @click="action({ type: 'volume', action: 'mute' })"
        >
          静音 / 恢复</button
        ><button
          :disabled="!online"
          aria-label="音量增大"
          @click="action({ type: 'volume', action: 'up' })"
        >
          <span>＋</span>音量
        </button>
      </div>
      <div class="play-row">
        <button
          :disabled="!online"
          @click="action({ type: 'key', key: 'left' })"
        >
          ← <small>左方向键</small></button
        ><button
          :disabled="!online"
          class="play"
          @click="action({ type: 'key', key: 'space' })"
        >
          Ⅱ / ▷ <small>空格键</small></button
        ><button
          :disabled="!online"
          @click="action({ type: 'key', key: 'right' })"
        >
          → <small>右方向键</small>
        </button>
      </div>
      <div class="utility-row">
        <button :disabled="!online" @click="cycle('next')">▣ 切换窗口</button
        ><button :disabled="!online" @click="action({ type: 'desktop' })">
          ▱ 显示桌面</button
        ><button :disabled="!online" @click="textOpen = !textOpen">
          ⌨ 输入文字
        </button>
      </div>
      <div v-if="switcher" class="switch-panel">
        <p>正在选择窗口 · 连续切换后确认</p>
        <div>
          <button @click="cycle('previous')">上一个</button
          ><button @click="cycle('next')">下一个</button
          ><button class="accent" @click="cycle('confirm')">确认</button
          ><button @click="cycle('cancel')">取消</button>
        </div>
      </div>
      <div class="extra-row">
        <button
          :disabled="!online"
          @click="action({ type: 'key', key: 'escape' })"
        >
          Esc</button
        ><button
          :disabled="!online"
          @click="action({ type: 'key', key: 'enter' })"
        >
          回车 ↵</button
        ><button
          :disabled="!online"
          @click="action({ type: 'scroll', dy: -120 })"
        >
          滚动 ↑</button
        ><button
          :disabled="!online"
          @click="action({ type: 'scroll', dy: 120 })"
        >
          滚动 ↓
        </button>
      </div>
    </section>
    <section v-if="textOpen" class="text-panel">
      <label for="remote-text">发送到电脑当前输入位置</label
      ><textarea
        id="remote-text"
        v-model="input"
        maxlength="1000"
        rows="3"
        placeholder="先在电脑上点选输入框，再在这里输入…"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      ></textarea>
      <div>
        <small>{{ input.length }} / 1000 · 不读取或修改剪贴板</small
        ><button
          class="accent"
          :disabled="!online || composing || sending || !input"
          @click="sendText"
        >
          {{ sending ? "发送中…" : "发送文字" }}
        </button>
      </div>
    </section>
    <footer>
      空格与方向键的效果取决于当前窗口和播放器。<br />关闭页面会释放按键；切回页面自动重连。
    </footer>
    <div v-if="feedback" class="toast" role="status">{{ feedback }}</div>
  </main>
</template>
