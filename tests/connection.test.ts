import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useConnection } from "../apps/mobile/connection";
class Socket {
  static OPEN = 1;
  static CLOSING = 2;
  static sockets: Socket[] = [];
  readyState = 0;
  bufferedAmount = 0;
  frames: any[] = [];
  onopen = () => {};
  onmessage = (event: { data: string }) => {};
  onclose = (event: { code: number }) => {};
  onerror = () => {};
  constructor() {
    Socket.sockets.push(this);
  }
  send(frame: string) {
    this.frames.push(JSON.parse(frame));
  }
  open() {
    this.readyState = 1;
    this.onopen();
    this.onmessage({ data: '{"kind":"ready"}' });
  }
  close(code = 1000) {
    this.readyState = 3;
    this.onclose({ code });
  }
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.sockets = [];
  vi.stubGlobal("WebSocket", Socket);
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("location", { protocol: "http:", host: "192.168.1.2:19827" });
  const storage = new Map([["pillow-token", "a".repeat(64)]]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k),
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("hiding releases and rejects pending actions, resuming sends only auth", async () => {
  const remote = useConnection();
  remote.resume();
  const first = Socket.sockets[0];
  first.open();
  const pending = remote
    .send({ type: "click", button: "left", count: 1 })
    .catch((e) => e.message);
  remote.suspend();
  expect(await pending).toContain("不会自动重发");
  expect(first.frames.at(-1).command).toEqual({ type: "release" });
  remote.resume();
  const second = Socket.sockets[1];
  second.open();
  expect(second.frames).toEqual([{ kind: "auth", token: "a".repeat(64) }]);
  remote.suspend();
});
it("automatically reconnects after network loss without replay", async () => {
  const remote = useConnection();
  remote.resume();
  Socket.sockets[0].open();
  Socket.sockets[0].close(1006);
  expect(remote.status.value).toBe("offline");
  expect(remote.connectionLabel.value).toBe("连接已断开，正在重连…");
  await vi.advanceTimersByTimeAsync(750);
  expect(Socket.sockets).toHaveLength(2);
  Socket.sockets[1].open();
  expect(remote.status.value).toBe("connected");
  expect(remote.connectionLabel.value).toBe("已连接");
  expect(Socket.sockets[1].frames).toHaveLength(1);
  remote.suspend();
});
it("a replaced tab does not fight the new controller with reconnect loops", async () => {
  const remote = useConnection();
  remote.resume();
  Socket.sockets[0].open();
  Socket.sockets[0].close(4001);
  await vi.advanceTimersByTimeAsync(10000);
  expect(Socket.sockets).toHaveLength(1);
  expect(remote.connectionLabel.value).toBe("连接已被接管，点击重连");
  remote.resume();
  expect(Socket.sockets).toHaveLength(2);
  remote.suspend();
});
it("revocation clears credentials and does not retry", async () => {
  const remote = useConnection();
  remote.resume();
  Socket.sockets[0].open();
  Socket.sockets[0].close(4003);
  await vi.advanceTimersByTimeAsync(10000);
  expect(remote.status.value).toBe("unpaired");
  expect(localStorage.getItem("pillow-token")).toBeUndefined();
  expect(Socket.sockets).toHaveLength(1);
});
it("reports a failed connection accurately and keeps controls offline", () => {
  const remote = useConnection();
  remote.resume();
  Socket.sockets[0].onerror();
  Socket.sockets[0].close(1006);
  expect(remote.connectionLabel.value).toBe("连接失败，点击重试");
  expect(remote.status.value).toBe("offline");
  expect(remote.message.value).toContain("防火墙");
});
it("a first authentication timeout is a failure, not a claimed prior connection", async () => {
  const remote = useConnection();
  remote.resume();
  await vi.advanceTimersByTimeAsync(5000);
  expect(remote.connectionLabel.value).toBe("连接失败，点击重试");
});

it("pairing rejects incomplete codes and prevents duplicate requests, preserving leading zero", async () => {
  let finish!: (value: unknown) => void;
  const fetcher = vi.fn((_url: string, _options: { body: string }) => new Promise(resolve => { finish = resolve; }));
  vi.stubGlobal("fetch", fetcher);
  const remote = useConnection();
  await remote.pair("123");
  expect(fetcher).not.toHaveBeenCalled();
  const request = remote.pair("012345");
  await remote.pair("012345");
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetcher.mock.calls[0][1].body).code).toBe("012345");
  finish({ ok: false, json: async () => ({ error: "配对码不正确，请核对电脑上显示的 6 位数字" }) });
  await request;
  expect(remote.message.value).toContain("配对码不正确");
});
it("pairing network failure does not claim credentials expired", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  const remote = useConnection();
  await remote.pair("123456");
  expect(remote.message.value).toContain("网络连接失败");
  expect(remote.message.value).not.toContain("过期");
});
