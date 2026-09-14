import { it, expect } from "vitest";
import cases from "../shared/protocol-cases.json";
import { clientSchema } from "../shared/protocol";
it.each(cases)(
  "shared Rust/TypeScript protocol: $name",
  ({ message, valid }) => {
    expect(clientSchema.safeParse(message).success).toBe(valid);
  },
);
