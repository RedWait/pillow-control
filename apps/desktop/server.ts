import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import { clientSchema } from "../../shared/protocol";
import { Pairing, Limiter } from "./security";
import { Dispatcher } from "./dispatcher";
import type { Controller } from "./windows";
export class RemoteServer {
  readonly pairing = new Pairing();
  private http = createServer((req, res) => {
    void this.handle(req, res).catch(() => {
      if (!res.headersSent) this.json(res, 500, { error: "服务异常" });
      else res.end();
    });
  });
  private wss = new WebSocketServer({
    noServer: true,
    maxPayload: 8192,
    perMessageDeflate: false,
  });
  private sockets = new Set<WebSocket>();
  private active: WebSocket | undefined;
  private dispatcher: Dispatcher;
  private attempts = new Limiter(6, 60_000);
  private globalAttempts = new Limiter(30, 60_000);
  private upgrades = new Limiter(30, 60_000);
  private origin = "";
  private heartbeat: NodeJS.Timeout | undefined;
  private lastAlive = 0;
  constructor(
    private root: string,
    controller: Controller,
    private changed: () => void = () => {},
  ) {
    this.dispatcher = new Dispatcher(controller);
    this.http.headersTimeout = 5000;
    this.http.requestTimeout = 5000;
    this.http.maxConnections = 32;
    this.http.on("upgrade", (req, socket, head) => {
      if (
        req.url !== "/ws" ||
        !this.isHost(req) ||
        req.headers.origin !== this.origin ||
        this.sockets.size >= 8 ||
        !this.upgrades.allow(req.socket.remoteAddress || "")
      ) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        return;
      }
      this.wss.handleUpgrade(req, socket, head, (ws) => this.connect(ws));
    });
  }
  get connected() {
    return !!this.active;
  }
  get address() {
    return this.origin;
  }
  async start(host: string, port: number) {
    this.origin = `http://${host}:${port}`;
    await new Promise<void>((resolve, reject) => {
      const failed = (e: Error) => {
        this.http.off("listening", ready);
        reject(e);
      };
      const ready = () => {
        this.http.off("error", failed);
        resolve();
      };
      this.http.once("error", failed);
      this.http.once("listening", ready);
      this.http.listen(port, host);
    });
    const addr = this.http.address();
    if (addr && typeof addr === "object")
      this.origin = `http://${host}:${addr.port}`;
    this.heartbeat = setInterval(() => {
      if (this.active && Date.now() - this.lastAlive > 3500)
        this.active.terminate();
    }, 500);
  }
  disconnect() {
    this.dispatcher.release();
    this.active = undefined;
    for (const ws of this.sockets) ws.close(4003, "Credentials revoked");
    this.changed();
  }
  rotate() {
    this.pairing.rotate();
    this.disconnect();
  }
  async stop() {
    clearInterval(this.heartbeat);
    this.rotate();
    for (const ws of this.sockets) ws.terminate();
    this.wss.close();
    await new Promise<void>((r) => {
      this.http.close(() => r());
      this.http.closeAllConnections();
    });
  }
  private isHost(req: IncomingMessage) {
    return req.headers.host === new URL(this.origin).host;
  }
  private json(res: ServerResponse, status: number, data: unknown) {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(data));
  }
  private async body(req: IncomingMessage) {
    let body = "";
    for await (const part of req) {
      body += part;
      if (Buffer.byteLength(body) > 2048) throw new Error("消息过大");
    }
    return JSON.parse(body);
  }
  private async handle(req: IncomingMessage, res: ServerResponse) {
    if (!this.isHost(req)) return this.json(res, 403, { error: "Host 不匹配" });
    const url = req.url || "/";
    if (url.startsWith("/api/")) {
      if (req.headers.origin !== this.origin)
        return this.json(res, 403, { error: "来源不匹配" });
      if (url === "/api/pair" && req.method === "POST") {
        if (
          !this.globalAttempts.allow("all") ||
          !this.attempts.allow(req.socket.remoteAddress || "")
        )
          return this.json(res, 429, { error: "尝试过于频繁，请等待一分钟" });
        if (req.headers["content-type"] !== "application/json")
          return this.json(res, 415, { error: "需要 JSON" });
        let body;
        try {
          body = await this.body(req);
        } catch {
          return this.json(res, 400, { error: "请求无效" });
        }
        const token = this.pairing.pair(
          typeof body?.code === "string" ? body.code : "",
        );
        if (!token)
          return this.json(res, 401, {
            error: "配对码错误或已过期，请在电脑端重新配对",
          });
        this.disconnect();
        this.changed();
        return this.json(res, 200, { token });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "") || "";
      if (!this.pairing.valid(token))
        return this.json(res, 401, { error: "需要配对" });
      if (url === "/api/status" && req.method === "GET")
        return this.json(res, 200, { connected: this.connected });
      return this.json(res, 404, { error: "没有此接口" });
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return this.json(res, 405, { error: "不支持的方法" });
    // Serve only the built entry and flat, fingerprinted Vite assets. No filesystem API.
    if (
      url !== "/" &&
      url !== "/index.html" &&
      !/^\/assets\/[a-zA-Z0-9_.-]+\.(js|css|svg|woff2)$/.test(url)
    )
      return this.json(res, 404, { error: "未找到" });
    try {
      const name = url === "/" ? "index.html" : url.slice(1);
      const body = await readFile(path.join(this.root, name));
      const ext = path.extname(name);
      res.writeHead(200, {
        "Content-Type":
          (
            {
              ".html": "text/html; charset=utf-8",
              ".js": "text/javascript",
              ".css": "text/css",
              ".svg": "image/svg+xml",
              ".woff2": "font/woff2",
            } as Record<string, string>
          )[ext] || "application/octet-stream",
        "Cache-Control": "no-store",
        "Content-Security-Policy": `default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' ${this.origin.replace("http:", "ws:")}; img-src 'self' data:; font-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      res.end(req.method === "HEAD" ? undefined : body);
    } catch {
      this.json(res, 404, { error: "手机页面未构建，请运行 npm run build" });
    }
  }
  private connect(ws: WebSocket) {
    this.sockets.add(ws);
    let authorized = false;
    let lastId = -1;
    const rate = new Limiter(100, 1000);
    const textRate = new Limiter(4, 10_000);
    const timeout = setTimeout(() => {
      if (!authorized) ws.close(4003, "Authentication timeout");
    }, 3000);
    const send = (data: unknown) => {
      if (ws.readyState === WebSocket.OPEN && ws.bufferedAmount < 16384)
        ws.send(JSON.stringify(data));
    };
    ws.on("error", () => {});
    ws.on("message", (raw, binary) => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (binary || !rate.allow("messages")) {
        ws.close(4008, "Rate or format limit");
        return;
      }
      let data;
      try {
        data = clientSchema.parse(JSON.parse(raw.toString()));
      } catch {
        ws.close(4002, "Invalid message");
        return;
      }
      if (!authorized) {
        if (data.kind !== "auth" || !this.pairing.valid(data.token)) {
          ws.close(4003, "Pairing required");
          return;
        }
        if (this.active && this.active !== ws) {
          this.active.close(4001, "Replaced");
          this.dispatcher.release();
        }
        authorized = true;
        this.active = ws;
        this.lastAlive = Date.now();
        clearTimeout(timeout);
        send({ kind: "ready" });
        this.changed();
        return;
      }
      if (this.active !== ws) {
        ws.close(4001);
        return;
      }
      if (data.kind === "ping") {
        this.lastAlive = Date.now();
        send({ kind: "pong" });
        return;
      }
      if (data.kind !== "command" || data.id <= lastId) {
        ws.close(4002, "Invalid sequence");
        return;
      }
      lastId = data.id;
      if (data.command.type === "text" && !textRate.allow("text")) {
        send({ kind: "ack", id: data.id, error: "文字发送过于频繁" });
        return;
      }
      this.dispatcher.submit(data.command, (error) =>
        send({
          kind: "ack",
          id: data.id,
          ...(error ? { error: error.message } : {}),
        }),
      );
    });
    ws.on("close", () => {
      clearTimeout(timeout);
      this.sockets.delete(ws);
      if (this.active === ws) {
        this.active = undefined;
        this.dispatcher.release();
        this.changed();
      }
    });
  }
}
