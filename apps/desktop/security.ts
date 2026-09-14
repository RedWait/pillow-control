import {
  randomBytes,
  randomInt,
  timingSafeEqual,
  createHash,
} from "node:crypto";
export class Pairing {
  code = "";
  private digest = "";
  private expires = 0;
  constructor() {
    this.rotate();
  }
  rotate() {
    this.code = String(randomInt(100000, 1000000));
    this.digest = "";
    this.expires = Date.now() + 10 * 60_000;
  }
  pair(code: string): string | null {
    if (
      Date.now() > this.expires ||
      !/^\d{6}$/.test(code) ||
      !timingSafeEqual(Buffer.from(code), Buffer.from(this.code))
    )
      return null;
    const token = randomBytes(32).toString("hex");
    this.digest = this.hash(token);
    this.code = String(randomInt(100000, 1000000));
    this.expires = Date.now() + 10 * 60_000;
    return token;
  }
  valid(token: string) {
    return (
      /^[a-f0-9]{64}$/.test(token) &&
      this.digest !== "" &&
      timingSafeEqual(Buffer.from(this.hash(token)), Buffer.from(this.digest))
    );
  }
  private hash(s: string) {
    return createHash("sha256").update(s).digest("hex");
  }
}
export class Limiter {
  private entries = new Map<string, { count: number; until: number }>();
  constructor(
    private max: number,
    private windowMs: number,
  ) {}
  allow(key: string, now = Date.now()) {
    for (const [k, v] of this.entries)
      if (v.until <= now) this.entries.delete(k);
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 1024) return false;
      entry = { count: 0, until: now + this.windowMs };
      this.entries.set(key, entry);
    }
    return ++entry.count <= this.max;
  }
}
