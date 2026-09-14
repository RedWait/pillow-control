import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import type { Command } from "../../shared/protocol";
export interface Controller {
  execute(command: Command): Promise<unknown>;
  release(): Promise<unknown>;
}
export class WindowsController implements Controller {
  private child: ChildProcessWithoutNullStreams;
  private id = 0;
  private pending = new Map<
    number,
    {
      resolve: (v: unknown) => void;
      reject: (e: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  private dead = false;
  constructor(
    exe: string,
    private onFailure: (error: string) => void = () => {},
  ) {
    this.child = spawn(exe, [], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      try {
        const reply = JSON.parse(line);
        const p = this.pending.get(reply.id);
        if (!p) return;
        clearTimeout(p.timer);
        this.pending.delete(reply.id);
        reply.ok ? p.resolve(reply.result) : p.reject(new Error(reply.error));
      } catch {
        this.fail("Windows 辅助程序响应无效");
      }
    });
    this.child.stderr.on("data", () => {});
    this.child.on("error", (e) => this.fail(`辅助程序无法启动：${e.message}`));
    this.child.on("exit", () =>
      this.fail("Windows 辅助程序已退出，请重启枕控"),
    );
    this.child.stdin.on("error", () => this.fail("Windows 控制管道已断开"));
  }
  private fail(message: string) {
    if (this.dead) return;
    this.dead = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    this.pending.clear();
    this.onFailure(message);
  }
  request(command: object): Promise<unknown> {
    if (this.dead) return Promise.reject(new Error("Windows 辅助程序不可用"));
    if (this.pending.size >= 32)
      return Promise.reject(new Error("控制繁忙，请稍后重试"));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Windows 操作超时，结果未知，请勿重复发送文字"));
      }, 3000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...command, id }) + "\n");
    });
  }
  execute(command: Command) {
    return this.request(command);
  }
  release() {
    return this.execute({ type: "release" });
  }
  async close() {
    try {
      await this.release();
    } finally {
      this.child.stdin.end();
    }
  }
}
