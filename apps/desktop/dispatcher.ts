import type { Command } from "../../shared/protocol";
import type { Controller } from "./windows";
// Bounded serial queue, merged motion; release invalidates all operations not yet started.
export class Dispatcher {
  private queue: { command: Command; done: (error?: Error) => void }[] = [];
  private busy = false;
  constructor(private controller: Controller) {}
  submit(command: Command, done: (error?: Error) => void = () => {}) {
    if (command.type === "release") {
      this.clear();
      this.queue.push({ command, done });
      this.pump();
      return;
    }
    const last = this.queue.at(-1);
    if (command.type === "move" && last?.command.type === "move") {
      last.command.dx = Math.max(
        -500,
        Math.min(500, last.command.dx + command.dx),
      );
      last.command.dy = Math.max(
        -500,
        Math.min(500, last.command.dy + command.dy),
      );
      done();
      return;
    }
    if (this.queue.length >= 16) {
      done(new Error("指令过多，已丢弃"));
      return;
    }
    this.queue.push({ command, done });
    this.pump();
  }
  clear() {
    for (const item of this.queue) item.done(new Error("连接变化，操作已取消"));
    this.queue = [];
  }
  release() {
    this.submit({ type: "release" });
  }
  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        try {
          await this.controller.execute(item.command);
          item.done();
        } catch (e) {
          item.done(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      this.busy = false;
    }
  }
}
