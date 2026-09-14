import { describe, it, expect } from "vitest";

import { commandSchema, clientSchema } from "../shared/protocol";
describe("credentials and validation", () => {
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
