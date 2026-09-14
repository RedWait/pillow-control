import { describe, it, expect } from "vitest";
import { Pairing, Limiter } from "../apps/desktop/security";
import { commandSchema, clientSchema } from "../shared/protocol";
describe("credentials and validation", () => {
  it("pairs only with current code, rotates random tokens, revokes old tokens", () => {
    const p = new Pairing();
    expect(p.pair("invalid")).toBeNull();
    expect(p.valid("a".repeat(64))).toBe(false);
    const first = p.pair(p.code)!;
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(p.valid(first)).toBe(true);
    const second = p.pair(p.code)!;
    expect(second).not.toBe(first);
    expect(p.valid(first)).toBe(false);
    p.rotate();
    expect(p.valid(second)).toBe(false);
  });
  it("bounds pairing attempts and recovers after expiry", () => {
    const rate = new Limiter(2, 1000);
    expect(rate.allow("ip", 0)).toBe(true);
    expect(rate.allow("ip", 1)).toBe(true);
    expect(rate.allow("ip", 2)).toBe(false);
    expect(rate.allow("ip", 1001)).toBe(true);
  });
  it.each([
    { type: "shell", command: "calc.exe" },
    { type: "move", dx: 501, dy: 0 },
    { type: "move", dx: NaN, dy: 0 },
    { type: "key", key: "ctrl" },
    { type: "text", text: "a".repeat(1001) },
    { type: "text", text: "\u0000" },
    { type: "release", extra: "execute" },
    { type: "click", button: "left", count: 3 },
  ])("rejects hostile or malformed commands: %j", (command) =>
    expect(commandSchema.safeParse(command).success).toBe(false),
  );
  it("accepts Chinese and emoji without transformation", () => {
    const command = { type: "text", text: "中文 English 😀\n第二行" };
    expect(commandSchema.parse(command)).toEqual(command);
  });
  it("requires safe monotonic-compatible ids", () => {
    expect(
      clientSchema.safeParse({
        kind: "command",
        id: -1,
        command: { type: "release" },
      }).success,
    ).toBe(false);
  });
});
