import { describe, it, expect } from "vitest";
import { TouchpadGesture, MotionBuffer } from "../apps/mobile/gestures";
describe("touchpad", () => {
  it("distinguishes a tap from a drag and long press", () => {
    const events: unknown[] = [];
    const g = new TouchpadGesture((...e) => events.push(e));
    g.down(1, { x: 0, y: 0 }, 0);
    g.up(1, 100);
    expect(events).toEqual([["tap", 0, 0]]);
    events.length = 0;
    g.down(1, { x: 0, y: 0 }, 200);
    g.move(1, { x: 20, y: 2 });
    g.up(1, 250);
    expect(events).toEqual([["move", 20, 2]]);
    events.length = 0;
    g.down(1, { x: 0, y: 0 }, 300);
    g.up(1, 800);
    expect(events).toEqual([]);
  });
  it("two fingers scroll and never become a stray click after lifting one", () => {
    const events: unknown[] = [];
    const g = new TouchpadGesture((...e) => events.push(e));
    g.down(1, { x: 0, y: 0 }, 0);
    g.down(2, { x: 20, y: 0 }, 5);
    g.move(1, { x: 0, y: 10 });
    g.move(2, { x: 20, y: 10 });
    g.up(2, 100);
    g.move(1, { x: 0, y: 15 });
    g.up(1, 120);
    expect(events).toEqual([
      ["scroll", 0, 5],
      ["scroll", 0, 5],
    ]);
  });
  it("cancellation loses old fingers and clears fractional motion", () => {
    const events: unknown[] = [];
    const g = new TouchpadGesture((...e) => events.push(e));
    g.down(1, { x: 0, y: 0 }, 0);
    g.cancel();
    g.up(1, 100);
    expect(events).toEqual([]);
    const m = new MotionBuffer();
    m.add(0.4, 0.5);
    expect(m.drain().dx).toBe(0);
    m.add(0.8, 0.7);
    expect(m.drain()).toEqual({ dx: 1, dy: 1, scroll: 0 });
    m.add(900, 900);
    m.clear();
    expect(m.drain()).toEqual({ dx: 0, dy: 0, scroll: 0 });
  });
});

it("capture loss only removes its own pointer and never resumes mouse movement", () => {
  const events: unknown[] = [];
  const g = new TouchpadGesture((...e) => events.push(e));
  g.down(1,{x:0,y:0},0); g.down(2,{x:20,y:0},1);
  g.up(2,100); g.lost(2);
  g.down(3,{x:20,y:0},110); g.move(1,{x:0,y:10});
  expect(events).toEqual([["scroll",0,5]]);
  g.lost(3); g.move(1,{x:0,y:20}); g.up(1,120);
  expect(events).toHaveLength(1);
});
it("accumulates small scroll deltas into complete detents, clears remainder on cancel", () => {
  const m = new MotionBuffer();
  for(let i=0;i<5;i++) { m.scroll += 20; expect(m.drain().scroll).toBe(0); }
  m.scroll += 40; expect(m.drain().scroll).toBe(120);
  m.clear(); m.scroll = -119; expect(m.drain().scroll).toBe(0);
  m.scroll -= 1; expect(m.drain().scroll).toBe(-120);
  expect(m.drain().scroll).toBe(0);
});
