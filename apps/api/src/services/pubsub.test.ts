import { describe, it, expect } from "bun:test";
import { PubSub } from "./pubsub.ts";

describe("PubSub", () => {
  it("delivers events to subscribed listeners only", () => {
    const bus = new PubSub<{ n: number }>();
    const a: number[] = [];
    const b: number[] = [];
    bus.subscribe("t1", (e) => a.push(e.n));
    bus.subscribe("t2", (e) => b.push(e.n));
    bus.publish("t1", { n: 1 });
    bus.publish("t1", { n: 2 });
    bus.publish("t2", { n: 99 });
    expect(a).toEqual([1, 2]);
    expect(b).toEqual([99]);
  });

  it("returns an unsubscribe function and cleans up empty topics", () => {
    const bus = new PubSub<number>();
    const got: number[] = [];
    const off = bus.subscribe("t", (v) => got.push(v));
    bus.publish("t", 7);
    off();
    bus.publish("t", 8);
    expect(got).toEqual([7]);
    expect(bus.count("t")).toBe(0);
  });

  it("swallows listener errors so other subscribers still fire", () => {
    const bus = new PubSub<string>();
    const seen: string[] = [];
    bus.subscribe("t", () => {
      throw new Error("nope");
    });
    bus.subscribe("t", (v) => seen.push(v));
    bus.publish("t", "hi");
    expect(seen).toEqual(["hi"]);
  });
});
