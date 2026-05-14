import type { EcosystemApp } from "./ecosystem.ts";
import { pm2NameForService } from "./pm2.ts";

export type PersistedService = {
  name: string;
  pm2Name: string;
  port: number | null;
  isPrimary: boolean;
};

export type ReconcileResult = {
  services: PersistedService[];
  removed: PersistedService[];
};

/**
 * Diff the parsed ecosystem against the currently persisted service list.
 * Preserves user overrides (port, isPrimary) on services that still exist.
 * Always returns a service list with exactly one primary, unless empty.
 */
export function reconcileServices(
  appId: string,
  existing: PersistedService[],
  parsed: EcosystemApp[],
): ReconcileResult {
  const existingByName = new Map(existing.map((s) => [s.name, s]));
  const parsedNames = new Set(parsed.map((p) => p.name));

  const services: PersistedService[] = parsed.map((eco) => {
    const prior = existingByName.get(eco.name);
    if (prior) {
      return {
        name: eco.name,
        pm2Name: pm2NameForService(appId, eco.name),
        port: prior.port,
        isPrimary: prior.isPrimary,
      };
    }
    return {
      name: eco.name,
      pm2Name: pm2NameForService(appId, eco.name),
      port: eco.port ?? null,
      isPrimary: false,
    };
  });

  const removed = existing.filter((s) => !parsedNames.has(s.name));

  // Ensure exactly one primary (only if there's at least one service).
  const first = services[0];
  if (first && !services.some((s) => s.isPrimary)) {
    first.isPrimary = true;
  }

  return { services, removed };
}
