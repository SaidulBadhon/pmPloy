import { describe, it, expect } from "bun:test";
import { appendSample, type MetricSample } from "@pmploy/shared";

const s = (t: number): MetricSample => ({ t, cpu: t, memory: t * 1024 });

describe("appendSample", () => {
  it("appends below cap", () => {
    const out = appendSample([s(1), s(2)], s(3), 5);
    expect(out).toEqual([s(1), s(2), s(3)]);
  });

  it("evicts oldest when over cap", () => {
    const out = appendSample([s(1), s(2), s(3)], s(4), 3);
    expect(out).toEqual([s(2), s(3), s(4)]);
  });

  it("works with empty history", () => {
    const out = appendSample([], s(1), 3);
    expect(out).toEqual([s(1)]);
  });

  it("returns a new array (does not mutate)", () => {
    const original: MetricSample[] = [s(1)];
    const out = appendSample(original, s(2), 3);
    expect(out).not.toBe(original);
    expect(original).toEqual([s(1)]);
  });
});
