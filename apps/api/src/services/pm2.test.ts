import { describe, test, expect } from "bun:test";
import { pm2NameForApp, pm2NameForService } from "./pm2.ts";

describe("pm2NameForApp", () => {
  test("returns the namespaced default service name", () => {
    expect(pm2NameForApp("64aabbccddeeff0011223344")).toBe(
      "pmploy:64aabbccddeeff0011223344:default",
    );
  });
});

describe("pm2NameForService", () => {
  test("combines app id and service name with the pmploy prefix", () => {
    expect(pm2NameForService("64aabbccddeeff0011223344", "web")).toBe(
      "pmploy:64aabbccddeeff0011223344:web",
    );
  });
});
