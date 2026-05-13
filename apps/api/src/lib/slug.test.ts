import { describe, it, expect } from "bun:test";
import { slugify, randomSuffix } from "./slug.ts";

describe("slugify", () => {
  it("lowercases and dashes", () => {
    expect(slugify("My Cool Team")).toBe("my-cool-team");
  });

  it("strips punctuation and trims dashes", () => {
    expect(slugify("  Foo!! Bar??  ")).toBe("foo-bar");
  });

  it("caps to 60 chars", () => {
    const long = "a".repeat(120);
    expect(slugify(long).length).toBe(60);
  });
});

describe("randomSuffix", () => {
  it("generates the requested length using a-z0-9", () => {
    const s = randomSuffix(8);
    expect(s).toHaveLength(8);
    expect(s).toMatch(/^[a-z0-9]+$/);
  });
});
