<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from "vue";
import QRCode from "qrcode";
import type { DesktopState } from "../../shared/protocol";
import "./style.css";
declare global {
  interface Window {
    pillow: {
      state: () => Promise<DesktopState>;
      action: (action: string, address?: string) => Promise<DesktopState>;
      subscribe: (callback: (state: DesktopState) => void) => () => void;
    };
  }
}
const state = ref<DesktopState>({
  running: false,
  connected: false,
  code: "",
  addresses: [],
  selected: "",
  port: 19827,
  error: "",
});
const selected = ref("");
const qr = ref("");
const busy = ref(false);
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
        color: { dark: "#152c32", light: "#ffffff" },
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
    const value = await window.pillow.action(name, selected.value);
    if (value) update(value);
  } catch (e) {
    state.value.error = String(e);
  } finally {
    busy.value = false;
  }
}
onMounted(async () => {
  update(await window.pillow.state());
  unsubscribe = window.pillow.subscribe(update);
});
onUnmounted(() => unsubscribe());
</script>
<template>
  <main>
    <header>
      <div class="brand-icon">◒</div>
      <div>
        <h1>枕控 PillowControl</h1>
        <p>手机在手，舒服遥控。</p>
      </div>
      <span class="version">v0.1.0 · Windows</span>
    </header>
    <section class="status">
      <span class="dot" :class="{ live: state.running }"></span>
      <div>
        <h2>
          {{
            state.connected
              ? "手机已连接"
              : state.running
                ? "准备好了，拿起手机扫码"
                : "遥控已停止"
          }}
        </h2>
        <p>
          {{
            state.connected
              ? "鼠标、音量和文字输入现已就绪"
              : state.running
                ? "手机与电脑连接同一个路由器，电脑使用网线也可以。"
                : "启动后，手机才能连接这台电脑。"
          }}
        </p>
      </div>
      <button
        :disabled="busy"
        :class="{ accent: !state.running }"
        @click="action(state.running ? 'stop' : 'start')"
      >
        {{ state.running ? "停止遥控" : "启动遥控" }}
      </button>
    </section>
    <p v-if="state.error" class="error" role="alert">{{ state.error }}</p>
    <div class="connection-grid">
      <section class="qr-card">
        <img v-if="qr" :src="qr" alt="用手机相机扫描此二维码连接电脑" />
        <div v-else class="qr-empty">启动遥控后显示二维码</div>
        <strong>用手机相机扫码</strong>
        <p>浏览器打开，无需安装 App</p>
      </section>
      <section class="details">
        <label for="network">连接地址</label
        ><select
          id="network"
          v-model="selected"
          :disabled="state.running || busy"
        >
          <option value="" disabled>请选择局域网网卡</option>
          <option
            v-for="item in state.addresses"
            :key="item.address"
            :value="item.address"
          >
            {{ item.name }} · {{ item.address
            }}{{ item.virtual ? "（虚拟 / VPN，谨慎选择）" : "" }}
          </option>
        </select>
        <p class="hint">更换网卡请先停止遥控，再选择并启动。</p>
        <code>{{ url || "暂未找到可用地址" }}</code>
        <p class="hint">也可以在手机浏览器手动输入上方地址。</p>
        <div class="pair-heading">
          <label>首次连接配对码</label
          ><button
            class="text-button"
            :disabled="!state.running || busy"
            @click="action('pair')"
          >
            重新配对 ↻
          </button>
        </div>
        <div class="pair-code">{{ state.code || "— — — — — —" }}</div>
        <p class="hint">
          10 分钟内有效，配对后自动更新。重新配对会撤销旧凭证。
        </p>
      </section>
    </div>
    <section class="help">
      <h3>连接不上？从这里检查</h3>
      <p>
        ① 手机连接家庭 Wi-Fi，电脑连接同一路由器。访客网络 / AP
        隔离可能阻止互访。
      </p>
      <p>
        ② Windows
        防火墙提示时仅允许「专用网络」。如没有提示，为此程序添加专用网络入站许可（TCP
        19827）。
      </p>
      <p>
        ③ 多网卡请优先选择真实以太网 / Wi-Fi
        地址；VPN、虚拟网卡或网络变化后请重新选择。
      </p>
    </section>
    <footer>
      <div>
        <span>只在可信局域网使用 · HTTP 未加密</span
        ><small
          >关闭窗口后继续在托盘运行；锁屏、UAC 和管理员窗口不支持遥控。</small
        >
      </div>
      <button
        :disabled="!state.connected || busy"
        @click="action('disconnect')"
      >
        断开并撤销手机</button
      ><button @click="action('quit')">退出枕控</button>
    </footer>
  </main>
</template>
