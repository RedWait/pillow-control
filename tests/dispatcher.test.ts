import { it, expect } from "vitest";
import { Dispatcher } from "../apps/desktop/dispatcher";
import type { Command } from "../shared/protocol";
it("disconnect discards queued clicks, prioritizes release, never replays", async () => {
  const sent: Command[] = [];
  let resolve!: () => void;
  const d = new Dispatcher({
    execute: async (c) => {
      sent.push(c);
      if (sent.length === 1) await new Promise<void>((r) => (resolve = r));
    },
    release: async () => {},
  });
  d.submit({ type: "move", dx: 1, dy: 2 });
  d.submit({ type: "click", button: "left", count: 1 });
  d.submit({ type: "key", key: "space" });
  d.release();
  resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(sent).toEqual([{ type: "move", dx: 1, dy: 2 }, { type: "release" }]);
});
it("coalesces queued motion and bounds overflow", async () => {
  const sent: Command[] = [];
  let resolve!: () => void;
  const errors: Error[] = [];
  const d = new Dispatcher({
    execute: async (c) => {
      sent.push(c);
      if (sent.length === 1) await new Promise<void>((r) => (resolve = r));
    },
    release: async () => {},
  });
  d.submit({ type: "key", key: "space" });
  d.submit({ type: "move", dx: 300, dy: 0 });
  d.submit({ type: "move", dx: 300, dy: 1 });
  for (let i = 0; i < 40; i++)
    d.submit({ type: "key", key: "left" }, (e) => {
      if (e) errors.push(e);
    });
  resolve();
  await new Promise((r) => setTimeout(r, 0));
  expect(sent[1]).toEqual({ type: "move", dx: 500, dy: 1 });
  expect(sent.length).toBeLessThanOrEqual(17);
  expect(errors.length).toBeGreaterThan(0);
});
