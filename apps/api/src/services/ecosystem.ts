import { existsSync } from "node:fs";
import path from "node:path";
import { runStreaming } from "./spawn.ts";

export type EcosystemApp = {
  name: string;
  script: string;
  cwd?: string;
  interpreter?: string;
  args?: string;
  instances?: number;
  execMode?: "fork" | "cluster";
  env?: Record<string, string>;
  port?: number;
};

export type ParsedEcosystem = {
  filePath: string;
  apps: EcosystemApp[];
};

const FILENAMES = ["ecosystem.config.cjs", "ecosystem.config.js", "ecosystem.config.json"];

/**
 * Look for an ecosystem config file in `dir`. Returns the absolute path
 * of the first match (in the order .cjs → .js → .json) or null.
 */
export function findEcosystemFile(dir: string): string | null {
  for (const name of FILENAMES) {
    const p = path.join(dir, name);
    if (existsSync(p)) return p;
  }
  return null;
}
