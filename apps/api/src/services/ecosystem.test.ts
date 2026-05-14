import { describe, test, expect } from "bun:test";
import path from "node:path";
import { parseEcosystem, findEcosystemFile } from "./ecosystem.ts";

const FIXTURES = path.resolve(import.meta.dir, "__fixtures__");

describe("findEcosystemFile", () => {
  test("returns null when no ecosystem file exists", () => {
    expect(findEcosystemFile("/tmp")).toBeNull();
  });

  test("finds a .cjs ecosystem file", () => {
    const p = findEcosystemFile(FIXTURES);
    // Any of the fixture .cjs files satisfies this; just assert it returns a path.
    expect(p).not.toBeNull();
    expect(p?.endsWith(".cjs")).toBe(true);
  });
});

describe("parseEcosystem", () => {
  test("parses a valid .cjs file into typed apps", async () => {
    const parsed = await parseEcosystem(path.join(FIXTURES, "ecosystem.valid.cjs"));
    expect(parsed.apps).toHaveLength(2);
    expect(parsed.apps[0]).toMatchObject({
      name: "web",
      script: "./build/index.js",
      port: 3000,
    });
    expect(parsed.apps[1]).toMatchObject({
      name: "worker",
      instances: 2,
      execMode: "cluster",
    });
  });

  test("rejects a file with no apps key", async () => {
    await expect(
      parseEcosystem(path.join(FIXTURES, "ecosystem.invalid.cjs")),
    ).rejects.toThrow(/declares no apps/);
  });

  test("rejects duplicate service names", async () => {
    await expect(
      parseEcosystem(path.join(FIXTURES, "ecosystem.duplicate.cjs")),
    ).rejects.toThrow(/duplicate service name/);
  });
});
