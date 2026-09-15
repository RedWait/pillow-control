import { computed, ref } from "vue";
import type { Command } from "../../shared/protocol";
export function useConnection() {
  const status = ref<"unpaired" | "connecting" | "connected" | "offline">(
    "unpaired",
  );
  const message = ref("输入电脑上的配对码，开始遥控");
  const phase = ref<"initial" | "retrying" | "failed" | "paused" | "replaced">("initial");
  const connectionLabel = computed(() => {
    if (status.value === "connected") return "已连接";
    if (status.value === "unpaired") return "点击配对";
    if (phase.value === "replaced") return "连接已被接管，点击重连";
    if (phase.value === "paused") return "连接已暂停，点击重连";
    if (phase.value === "failed") return "连接失败，点击重试";
    if (phase.value === "retrying") return "连接已断开，正在重连…";
    return "正在连接…";
  });
  let token = "";
  try {
    token = localStorage.getItem("pillow-token") || "";
  } catch {}
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let attempt = 0;
  let id = 0;
  let lastPong = 0;
  let suspended = false;
  const pending = new Map<
    number,
    {
      resolve: () => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const clearPending = () => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("连接中断，操作结果可能未知；不会自动重发"));
    }
    pending.clear();
  };
  const saveToken = (value: string) => {
    token = value;
    try {
      value
        ? localStorage.setItem("pillow-token", value)
        : localStorage.removeItem("pillow-token");
    } catch {}
  };
  function connect() {
    clearTimeout(retry);
    if (!token || document.hidden || suspended) return;
    status.value = "connecting";
    message.value = "正在连接电脑…";
    const ws = new WebSocket(
      `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
    );
    socket = ws;
    const openTimeout = setTimeout(() => {
      if (status.value !== "connected") ws.close();
    }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ kind: "auth", token }));
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        ws.close();
        return;
      }
      if (data.kind === "ready") {
        clearTimeout(openTimeout);
        status.value = "connected";
        phase.value = "initial";
        message.value = "已连接，可以遥控";
        attempt = 0;
        lastPong = Date.now();
        heartbeat = setInterval(() => {
          if (Date.now() - lastPong > 4000) {
            ws.close();
            return;
          }
          if (ws.readyState === WebSocket.OPEN)
            ws.send(JSON.stringify({ kind: "ping" }));
        }, 1000);
      }
      if (data.kind === "pong") lastPong = Date.now();
      if (data.kind === "ack") {
        const p = pending.get(data.id);
        if (!p) return;
        clearTimeout(p.timer);
        pending.delete(data.id);
        data.error ? p.reject(new Error(data.error)) : p.resolve();
      }
    };
    ws.onclose = (event) => {
      clearTimeout(openTimeout);
      if (socket !== ws) return;
      clearInterval(heartbeat);
      clearPending();
      socket = undefined;
      if (event.code === 4003) {
        saveToken("");
        status.value = "unpaired";
        message.value = "凭证已失效，请重新配对";
        return;
      }
      if (event.code === 4001) {
        suspended = true;
        phase.value = "replaced";
        status.value = "offline";
        message.value = "另一页面已接管连接，点击重新连接可接管回来";
        return;
      }
      if (status.value === "connecting" && phase.value === "initial" && !suspended) phase.value = "failed";
      status.value = token ? "offline" : "unpaired";
      if (!suspended && !document.hidden && phase.value !== "failed") phase.value = "retrying";
      message.value = phase.value === "failed" ? "连接失败，请检查电脑服务、Wi-Fi 和防火墙" : "连接已断开，旧操作已清空";
      if (token && !suspended && !document.hidden)
        retry = setTimeout(connect, Math.min(5000, 700 * 2 ** attempt++));
    };
    ws.onerror = () => {
      if (socket !== ws) return;
      phase.value = "failed";
      message.value = "连接失败，请检查电脑服务、Wi-Fi 和防火墙";
    };
  }
  async function pair(code: string) {
    message.value = "正在配对…";
    try {
      const res = await fetch("/api/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
        signal: AbortSignal.timeout(6000),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "配对失败");
      suspend();
      saveToken(result.token);
      suspended = false;
      phase.value = "initial";
      connect();
    } catch (e) {
      message.value = e instanceof Error ? e.message : "连接失败";
    }
  }
  function send(command: Command): Promise<void> {
    if (
      status.value !== "connected" ||
      !socket ||
      socket.readyState !== WebSocket.OPEN ||
      document.hidden
    )
      return Promise.reject(new Error("尚未连接，操作未发送"));
    if (socket.bufferedAmount > 8192 || pending.size >= 32)
      return Promise.reject(new Error("网络繁忙，操作已丢弃"));
    const next = ++id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(next);
        reject(new Error("操作确认超时，结果未知；请检查电脑后再试"));
      }, 4500);
      pending.set(next, { resolve, reject, timer });
      socket!.send(JSON.stringify({ kind: "command", id: next, command }));
    });
  }
  function suspend() {
    suspended = true;
    phase.value = "paused";
    clearTimeout(retry);
    clearInterval(heartbeat);
    if (socket?.readyState === WebSocket.OPEN)
      socket.send(
        JSON.stringify({
          kind: "command",
          id: ++id,
          command: { type: "release" },
        }),
      );
    socket?.close();
    clearPending();
    status.value = token ? "offline" : "unpaired";
  }
  function resume() {
    suspended = false;
    if (phase.value === "paused" || phase.value === "replaced") phase.value = "initial";
    if (!socket || socket.readyState >= WebSocket.CLOSING) connect();
  }
  function forget() {
    suspend();
    saveToken("");
    status.value = "unpaired";
    message.value = "已忘记本机凭证，可重新配对";
  }
  return { status, message, connectionLabel, pair, send, suspend, resume, forget };
}
