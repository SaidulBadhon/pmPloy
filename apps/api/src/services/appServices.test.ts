import { describe, test, expect } from "bun:test";
import { reconcileServices, type PersistedService } from "./appServices.ts";
import type { EcosystemApp } from "./ecosystem.ts";

const appId = "64aabbccddeeff0011223344";

function ecoApp(name: string, port?: number): EcosystemApp {
  return { name, script: `${name}.js`, port };
}

describe("reconcileServices", () => {
  test("adds new services and marks the first one primary when none exists", () => {
    const out = reconcileServices(appId, [], [ecoApp("web", 3000), ecoApp("worker")]);
    expect(out.services).toHaveLength(2);
    expect(out.services[0]).toMatchObject({
      name: "web",
      pm2Name: `pmploy:${appId}:web`,
      port: 3000,
      isPrimary: true,
    });
    expect(out.services[1]?.isPrimary).toBe(false);
    expect(out.removed).toEqual([]);
  });

  test("preserves user port and isPrimary overrides on existing services", () => {
    const existing: PersistedService[] = [
      { name: "web", pm2Name: `pmploy:${appId}:web`, port: 9999, isPrimary: false },
      { name: "worker", pm2Name: `pmploy:${appId}:worker`, port: null, isPrimary: true },
    ];
    const out = reconcileServices(appId, existing, [ecoApp("web", 3000), ecoApp("worker")]);
    expect(out.services[0]?.port).toBe(9999);
    expect(out.services[1]?.isPrimary).toBe(true);
    expect(out.services[0]?.isPrimary).toBe(false);
  });

  test("marks removed services for teardown", () => {
    const existing: PersistedService[] = [
      { name: "web", pm2Name: `pmploy:${appId}:web`, port: 3000, isPrimary: true },
      { name: "old", pm2Name: `pmploy:${appId}:old`, port: 4000, isPrimary: false },
    ];
    const out = reconcileServices(appId, existing, [ecoApp("web", 3000)]);
    expect(out.services.map((s) => s.name)).toEqual(["web"]);
    expect(out.removed.map((s) => s.name)).toEqual(["old"]);
  });

  test("promotes a survivor to primary when the primary is removed", () => {
    const existing: PersistedService[] = [
      { name: "web", pm2Name: `pmploy:${appId}:web`, port: 3000, isPrimary: true },
      { name: "worker", pm2Name: `pmploy:${appId}:worker`, port: null, isPrimary: false },
    ];
    const out = reconcileServices(appId, existing, [ecoApp("worker")]);
    expect(out.services[0]).toMatchObject({ name: "worker", isPrimary: true });
  });
});
