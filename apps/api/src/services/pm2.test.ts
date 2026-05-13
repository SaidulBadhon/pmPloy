import { describe, it, expect } from "bun:test";
import { pm2NameForApp } from "./pm2.ts";

describe("pm2NameForApp", () => {
  it("uses the pmploy:<id> convention", () => {
    expect(pm2NameForApp("64aabbccddeeff0011223344")).toBe(
      "pmploy:64aabbccddeeff0011223344",
    );
  });
});
