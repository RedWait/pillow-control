export interface Point {
  x: number;
  y: number;
}
// Pure gesture state makes cancellation and one-to-two-finger transitions testable.
export class TouchpadGesture {
  private points = new Map<number, Point>();
  private start: Point = { x: 0, y: 0 };
  private started = 0;
  private travelled = 0;
  private multi = false;
  constructor(
    private emit: (
      kind: "move" | "scroll" | "tap",
      x: number,
      y: number,
    ) => void,
  ) {}
  down(id: number, p: Point, now: number) {
    if (this.points.size === 0) {
      this.start = p;
      this.started = now;
      this.travelled = 0;
      this.multi = false;
    }
    this.points.set(id, p);
    if (this.points.size > 1) this.multi = true;
  }
  move(id: number, p: Point) {
    const prev = this.points.get(id);
    if (!prev) return;
    this.points.set(id, p);
    this.travelled = Math.max(
      this.travelled,
      Math.hypot(p.x - this.start.x, p.y - this.start.y),
    );
    if (this.points.size === 1 && !this.multi)
      this.emit("move", p.x - prev.x, p.y - prev.y);
    else if (this.points.size === 2) this.emit("scroll", 0, (p.y - prev.y) / 2);
  }
  up(id: number, now: number) {
    if (!this.points.has(id)) return;
    if (
      this.points.size === 1 &&
      !this.multi &&
      this.travelled < 8 &&
      now - this.started < 280
    )
      this.emit("tap", 0, 0);
    this.points.delete(id);
  }
  cancel() {
    this.points.clear();
    this.multi = false;
    this.travelled = 0;
  }
}
export class MotionBuffer {
  x = 0;
  y = 0;
  scroll = 0;
  add(x: number, y: number) {
    this.x = Math.max(-500, Math.min(500, this.x + x));
    this.y = Math.max(-500, Math.min(500, this.y + y));
  }
  drain() {
    const dx = Math.trunc(this.x),
      dy = Math.trunc(this.y),
      scroll = Math.trunc(this.scroll);
    this.x -= dx;
    this.y -= dy;
    this.scroll -= scroll;
    return { dx, dy, scroll: Math.max(-600, Math.min(600, scroll)) };
  }
  clear() {
    this.x = 0;
    this.y = 0;
    this.scroll = 0;
  }
}
