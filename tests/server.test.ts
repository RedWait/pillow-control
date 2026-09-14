import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { RemoteServer } from "../apps/desktop/server";
import type { Command } from "../shared/protocol";
let server: RemoteServer;
let commands: Command[];
let clients: WebSocket[];
const delay = () => new Promise((r) => setTimeout(r, 30));
beforeEach(async () => {
  commands = [];
  clients = [];
  server = new RemoteServer("dist/mobile", {
    execute: async (c) => {
      commands.push(c);
    },
    release: async () => {},
  });
  await server.start("127.0.0.1", 0);
});
afterEach(async () => {
  for (const c of clients) c.terminate();
  await server.stop();
});
async function pair() {
  const r = await fetch(server.address + "/api/pair", {
    method: "POST",
    headers: { Origin: server.address, "Content-Type": "application/json" },
    body: JSON.stringify({ code: server.pairing.code }),
  });
  return (await r.json()).token as string;
}
async function socket() {
  const ws = new WebSocket(server.address.replace("http", "ws") + "/ws", {
    origin: server.address,
  });
  clients.push(ws);
  await new Promise<void>((r, j) => {
    ws.once("open", r);
    ws.once("error", j);
  });
  return ws;
}
async function auth(ws: WebSocket, token: string) {
  const ready = new Promise((r) => ws.once("message", r));
  ws.send(JSON.stringify({ kind: "auth", token }));
  await ready;
}
describe("real HTTP/WebSocket security boundary", () => {
  it("blocks missing auth on HTTP and WS, no control is executed", async () => {
    expect(
      (
        await fetch(server.address + "/api/status", {
          headers: { Origin: server.address },
        })
      ).status,
    ).toBe(401);
    const ws = await socket();
    const closed = new Promise<number>((r) => ws.once("close", r));
    ws.send(
      JSON.stringify({
        kind: "command",
        id: 1,
        command: { type: "click", button: "left", count: 1 },
      }),
    );
    expect(await closed).toBe(4003);
    expect(commands.filter((c) => c.type !== "release")).toEqual([]);
  });
  it("rejects cross-origin pairing and socket upgrade", async () => {
    expect(
      (
        await fetch(server.address + "/api/pair", {
          method: "POST",
          headers: {
            Origin: "http://evil.test",
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(403);
    const ws = new WebSocket(server.address.replace("http", "ws") + "/ws", {
      origin: "http://evil.test",
    });
    clients.push(ws);
    expect(
      await new Promise<number>((r) => {
        ws.on("unexpected-response", (_, res) => {
          r(res.statusCode!);
          ws.terminate();
        });
        ws.on("error", () => {});
      }),
    ).toBe(403);
  });
  it("pairs, executes allowlisted command, releases on disconnect and rejects revoked token", async () => {
    const token = await pair();
    const ws = await socket();
    await auth(ws, token);
    const ack = new Promise((r) => ws.once("message", r));
    ws.send(
      JSON.stringify({
        kind: "command",
        id: 1,
        command: { type: "key", key: "space" },
      }),
    );
    await ack;
    expect(commands).toContainEqual({ type: "key", key: "space" });
    ws.close();
    await delay();
    expect(commands.at(-1)).toEqual({ type: "release" });
    server.rotate();
    const revoked = await socket();
    const closed = new Promise<number>((r) => revoked.once("close", r));
    revoked.send(JSON.stringify({ kind: "auth", token }));
    expect(await closed).toBe(4003);
  });
  it("rejects duplicate command ids instead of replaying a click", async () => {
    const token = await pair();
    const ws = await socket();
    await auth(ws, token);
    const frame = JSON.stringify({
      kind: "command",
      id: 1,
      command: { type: "click", button: "left", count: 1 },
    });
    ws.send(frame);
    await delay();
    const closed = new Promise<number>((r) => ws.once("close", r));
    ws.send(frame);
    expect(await closed).toBe(4002);
    expect(commands.filter((c) => c.type === "click")).toHaveLength(1);
  });
  it("enforces pairing rate and message size", async () => {
    for (let i = 0; i < 6; i++)
      await fetch(server.address + "/api/pair", {
        method: "POST",
        headers: { Origin: server.address, "Content-Type": "application/json" },
        body: '{"code":"wrong"}',
      });
    expect(
      (
        await fetch(server.address + "/api/pair", {
          method: "POST",
          headers: {
            Origin: server.address,
            "Content-Type": "application/json",
          },
          body: "{}",
        })
      ).status,
    ).toBe(429);
    const ws = await socket();
    const closed = new Promise<number>((r) => ws.once("close", r));
    ws.send("x".repeat(9000));
    expect(await closed).toBe(1009);
  });
  it("does not serve arbitrary files or accept HTTP control", async () => {
    const page = await fetch(server.address);
    expect(page.headers.get("content-security-policy")).toContain(
      `connect-src 'self' ${server.address.replace("http:", "ws:")};`,
    );
    expect((await fetch(server.address + "/package.json")).status).toBe(404);
    expect(
      (
        await fetch(server.address + "/api/control", {
          method: "POST",
          headers: { Origin: server.address },
        })
      ).status,
    ).toBe(401);
  });
});
