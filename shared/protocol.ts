import { z } from "zod";
export const commandSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("move"),
      dx: z.number().int().min(-500).max(500),
      dy: z.number().int().min(-500).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal("click"),
      button: z.enum(["left", "right"]),
      count: z.union([z.literal(1), z.literal(2)]),
    })
    .strict(),
  z
    .object({
      type: z.literal("scroll"),
      dy: z.number().int().min(-600).max(600),
    })
    .strict(),
  z
    .object({
      type: z.literal("key"),
      key: z.enum(["space", "left", "right", "up", "down", "enter", "escape", "backspace"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("volume"),
      action: z.enum(["up", "down", "mute"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("switch"),
      action: z.enum(["next", "previous", "confirm", "cancel"]),
    })
    .strict(),
  z.object({ type: z.literal("desktop") }).strict(),
  z
    .object({
      type: z.literal("text"),
      text: z
        .string()
        .min(1)
        .max(1000)
        .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)),
    })
    .strict(),
  z.object({ type: z.literal("magnifier"), enabled: z.boolean() }).strict(),
  z.object({ type: z.literal("shutdown"), confirmed: z.literal(true) }).strict(),
  z.object({ type: z.literal("release") }).strict(),
]);
export type Command = z.infer<typeof commandSchema>;
export const clientSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("auth"),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ kind: z.literal("ping") }).strict(),
  z
    .object({
      kind: z.literal("command"),
      id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
      command: commandSchema,
    })
    .strict(),
]);
export interface DesktopState {
  halo: { enabled: boolean; size: "small" | "medium" | "large" };
  autostart: boolean;
  trusted: boolean;
  running: boolean;
  connected: boolean;
  code: string;
  codeRemaining: number;
  addresses: { name: string; address: string; virtual: boolean }[];
  selected: string;
  port: number;
  error: string;
}
