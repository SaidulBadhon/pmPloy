import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
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

const PARSE_TIMEOUT_MS = 10_000;
const PM2_NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Read and evaluate an ecosystem config file. For .cjs/.js we shell out to a
 * fresh bun subprocess to keep evaluation isolated and bounded; for .json we
 * just parse the file.
 *
 * Throws on: missing/invalid `apps`, duplicate names, invalid name characters,
 * parse errors, and timeouts.
 */
export async function parseEcosystem(filePath: string): Promise<ParsedEcosystem> {
  const ext = path.extname(filePath);
  let raw: unknown;
  if (ext === ".json") {
    raw = JSON.parse(await readFile(filePath, "utf-8"));
  } else if (ext === ".cjs" || ext === ".js") {
    raw = await evalInSubprocess(filePath);
  } else {
    throw new Error(`unsupported ecosystem file extension: ${ext}`);
  }

  if (!raw || typeof raw !== "object") {
    throw new Error("ecosystem file did not export an object");
  }
  const apps = (raw as { apps?: unknown }).apps;
  if (!Array.isArray(apps) || apps.length === 0) {
    throw new Error("ecosystem file declares no apps");
  }

  const seen = new Set<string>();
  const normalized: EcosystemApp[] = apps.map((entry, idx) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`apps[${idx}] is not an object`);
    }
    const a = entry as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name) throw new Error(`apps[${idx}] is missing a "name"`);
    if (!PM2_NAME_RE.test(name)) {
      throw new Error(
        `service name "${name}" contains invalid characters; allowed: [A-Za-z0-9._-]`,
      );
    }
    if (seen.has(name)) throw new Error(`duplicate service name "${name}"`);
    seen.add(name);

    const script = typeof a.script === "string" ? a.script : "";
    if (!script) throw new Error(`service "${name}" is missing a "script"`);

    const env = (a.env && typeof a.env === "object") ? (a.env as Record<string, string>) : {};
    const portFromEnv = parsePort(env.PORT);

    return {
      name,
      script,
      cwd: typeof a.cwd === "string" ? a.cwd : undefined,
      interpreter: typeof a.interpreter === "string" ? a.interpreter : undefined,
      args: typeof a.args === "string" ? a.args : undefined,
      instances: typeof a.instances === "number" ? a.instances : undefined,
      execMode:
        a.exec_mode === "cluster" || a.exec_mode === "fork"
          ? a.exec_mode
          : undefined,
      env,
      port: portFromEnv,
    };
  });

  return { filePath, apps: normalized };
}

function parsePort(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isInteger(v) && v > 0) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

async function evalInSubprocess(filePath: string): Promise<unknown> {
  let out = "";
  const run = runStreaming(
    [
      "bun",
      "-e",
      `process.stdout.write(JSON.stringify(require(${JSON.stringify(filePath)})))`,
    ],
    {
      cwd: path.dirname(filePath),
      onLine: (line) => {
        out += line + "\n";
      },
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`ecosystem file evaluation timed out after ${PARSE_TIMEOUT_MS}ms`)),
      PARSE_TIMEOUT_MS,
    );
  });
  let code: number;
  try {
    code = await Promise.race([run, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (code !== 0) {
    throw new Error(`bun -e exited with code ${code} while evaluating ecosystem file`);
  }
  try {
    return JSON.parse(out);
  } catch (err) {
    throw new Error(
      `failed to parse ecosystem file output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export const ECOSYSTEM_PARSE_TIMEOUT_MS = PARSE_TIMEOUT_MS;
