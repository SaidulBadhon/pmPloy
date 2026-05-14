# Multi-Process App Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one pmPloy Application own multiple PM2 processes declared in `ecosystem.config.{cjs,js,json}`, with per-service port + domain routing, status aggregation, teardown, and runtime log streaming.

**Architecture:** Auto-detect an ecosystem file in the build directory at deploy time. Parse it in an isolated bun subprocess, reconcile against the persisted `services` array on the Application (preserving user port/isPrimary overrides), and start each declared service under a pmPloy-namespaced PM2 name (`pmploy:<appId>:<serviceName>`). Single-process apps continue to work and are internally represented as a one-service app named `default`. Caddy routes each Domain to a per-service port. A new SSE endpoint tails per-service stdout/stderr from PM2's log files.

**Tech Stack:** TypeScript, Bun, Mongoose, Hono, PM2, Caddy, Zod, bun:test.

**Scope:** API/backend only. UI changes are intentionally out of scope for this plan — they will be a follow-up plan once the API is shipped.

**Spec:** [docs/superpowers/specs/2026-05-14-multi-process-app-support-design.md](../specs/2026-05-14-multi-process-app-support-design.md)

---

## File Map

**New files:**
- `apps/api/src/services/ecosystem.ts` — parse `ecosystem.config.{cjs,js,json}`, return typed apps list
- `apps/api/src/services/ecosystem.test.ts`
- `apps/api/src/services/appServices.ts` — reconcile parsed ecosystem against persisted services (preserve overrides)
- `apps/api/src/services/appServices.test.ts`
- `apps/api/src/services/processLogs.ts` — tail PM2 stdout/stderr files
- `apps/api/src/services/processLogs.test.ts`
- `apps/api/src/services/__fixtures__/ecosystem.valid.cjs` — test fixture
- `apps/api/src/services/__fixtures__/ecosystem.invalid.cjs` — test fixture
- `apps/api/src/services/__fixtures__/ecosystem.duplicate.cjs` — test fixture

**Modified files:**
- `apps/api/src/models/Application.ts` — add embedded `services` array
- `apps/api/src/models/Domain.ts` — add `serviceName` field
- `apps/api/src/services/pm2.ts` — `pm2NameForApp` returns `:default`; add `pm2NameForService`
- `apps/api/src/services/deploy.ts` — ecosystem detection, multi-service startup, reconciliation, per-service teardown, `resyncDomains` routes per-service
- `apps/api/src/routes/apps.ts` — services in `applicationView`; start/stop/restart/delete iterate services; new `GET /:id/services/:name/logs` SSE route
- `apps/api/src/routes/domains.ts` — accept + validate `serviceName` on attach; retry routes to the correct service port
- `packages/shared/src/schemas.ts` — `PublicServiceSchema`, update `PublicApplicationSchema`, update `AttachDomainInputSchema`, update `PublicDomainSchema`

---

## Task 1: Add `Service` subdoc to `Application` model

**Files:**
- Modify: `apps/api/src/models/Application.ts`

- [ ] **Step 1: Add the service subschema and field**

Replace the contents of `apps/api/src/models/Application.ts` with:

```ts
import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const githubSourceSchema = new Schema(
  {
    installationId: { type: Number, required: true },
    repo: { type: String, required: true }, // "owner/name"
    branch: { type: String, required: true, default: "main" },
    rootDir: { type: String, default: "" }, // optional sub-directory
    buildCommand: { type: String, default: "" },
  },
  { _id: false },
);

const serviceSchema = new Schema(
  {
    name: { type: String, required: true },        // from ecosystem.config.cjs
    pm2Name: { type: String, required: true },     // "pmploy:<appId>:<name>"
    port: { type: Number, default: null },         // null = no public port
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const applicationSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },

    sourceType: {
      type: String,
      enum: ["local", "github"],
      default: "local",
      required: true,
    },
    cwd: { type: String, default: "" },
    script: { type: String, required: true },
    interpreter: { type: String, default: "" },
    instances: { type: Number, default: 1 },
    execMode: {
      type: String,
      enum: ["fork", "cluster"],
      default: "fork",
      required: true,
    },

    github: { type: githubSourceSchema, required: false },

    port: { type: Number, required: false },

    status: {
      type: String,
      enum: ["created", "deploying", "running", "stopped", "errored", "degraded"],
      default: "created",
      required: true,
    },
    pm2Name: { type: String, required: true },
    services: { type: [serviceSchema], default: [] },
  },
  { timestamps: true },
);

applicationSchema.index({ teamId: 1, slug: 1 }, { unique: true });

export type ServiceDoc = InferSchemaType<typeof serviceSchema>;
export type ApplicationDoc = InferSchemaType<typeof applicationSchema> & {
  _id: Types.ObjectId;
};
export const Application: Model<ApplicationDoc> = model<ApplicationDoc>(
  "Application",
  applicationSchema,
);
```

- [ ] **Step 2: Run typecheck to confirm no consumers break**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS (the existing fields are unchanged; only additive changes).

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/models/Application.ts
git commit -m "feat(api): add services subdoc + degraded status to Application model"
```

---

## Task 2: Add `serviceName` to `Domain` model

**Files:**
- Modify: `apps/api/src/models/Domain.ts`

- [ ] **Step 1: Add the field**

In `apps/api/src/models/Domain.ts`, inside the `domainSchema` definition, add this field above the closing `}`:

```ts
serviceName: { type: String, default: "" }, // "" = route to the primary service
```

The schema block now looks like:

```ts
const domainSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    appId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    host: { type: String, required: true, lowercase: true, trim: true, unique: true },
    sslStatus: {
      type: String,
      enum: ["pending", "active", "error", "unknown"],
      default: "pending",
      required: true,
    },
    lastError: { type: String, default: "" },
    serviceName: { type: String, default: "" },
  },
  { timestamps: true },
);
```

- [ ] **Step 2: Typecheck + commit**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS.

```bash
git add apps/api/src/models/Domain.ts
git commit -m "feat(api): add serviceName field to Domain"
```

---

## Task 3: Update shared Zod schemas

**Files:**
- Modify: `packages/shared/src/schemas.ts`

- [ ] **Step 1: Add `PublicServiceSchema` + update `AppStatusSchema`**

Replace `AppStatusSchema` (currently around line 15):

```ts
export const AppStatusSchema = z.enum([
  "created",
  "deploying",
  "running",
  "degraded",
  "stopped",
  "errored",
]);
export type AppStatus = z.infer<typeof AppStatusSchema>;
```

Then, just below the existing `Pm2InfoSchema` block (around line 156), add:

```ts
export const PublicServiceSchema = z.object({
  name: z.string(),
  pm2Name: z.string(),
  port: z.number().nullable(),
  isPrimary: z.boolean(),
  pm2: Pm2InfoSchema.nullable(),
});
export type PublicService = z.infer<typeof PublicServiceSchema>;
```

- [ ] **Step 2: Update `PublicApplicationSchema`**

Replace the existing `PublicApplicationSchema` block with:

```ts
export const PublicApplicationSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  slug: z.string(),
  sourceType: z.enum(["local", "github"]),
  cwd: z.string(),
  script: z.string(),
  interpreter: z.string(),
  instances: z.number(),
  execMode: ExecModeSchema,
  github: GithubSourceSchema.nullable(),
  port: z.number().nullable(),
  status: AppStatusSchema,
  pm2Name: z.string(),
  pm2: Pm2InfoSchema.nullable(),
  services: z.array(PublicServiceSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicApplication = z.infer<typeof PublicApplicationSchema>;
```

- [ ] **Step 3: Update Domain schemas**

Replace `AttachDomainInputSchema` and `PublicDomainSchema`:

```ts
export const AttachDomainInputSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(HOST_REGEX, "invalid hostname"),
  serviceName: z.string().trim().max(80).optional().default(""),
});
export type AttachDomainInput = z.infer<typeof AttachDomainInputSchema>;

export const PublicDomainSchema = z.object({
  id: z.string(),
  appId: z.string(),
  teamId: z.string(),
  host: z.string(),
  sslStatus: SslStatusSchema,
  lastError: z.string(),
  serviceName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicDomain = z.infer<typeof PublicDomainSchema>;
```

- [ ] **Step 4: Typecheck the whole repo**

Run: `bun --filter '*' typecheck`
Expected: typecheck failures in `apps/api/src/routes/apps.ts` and `apps/api/src/routes/domains.ts` because their view functions don't yet return `services` / `serviceName`. **This is expected.** They will be fixed in Tasks 8 and 9. The shared package itself should typecheck cleanly.

If `@pmploy/shared` typecheck fails, fix before continuing. If only the API fails, proceed.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add PublicService schema and serviceName to Domain"
```

---

## Task 4: Update PM2 naming helpers

**Files:**
- Modify: `apps/api/src/services/pm2.ts`
- Modify: `apps/api/src/services/pm2.test.ts`

- [ ] **Step 1: Update the existing failing test**

Open `apps/api/src/services/pm2.test.ts` and replace it with:

```ts
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `bun test apps/api/src/services/pm2.test.ts`
Expected: FAIL — `pm2NameForApp` returns the old `pmploy:<appId>` value and `pm2NameForService` is undefined.

- [ ] **Step 3: Update the implementation**

In `apps/api/src/services/pm2.ts`, replace the `pm2NameForApp` function at the bottom of the file with:

```ts
export function pm2NameForApp(appId: string): string {
  return pm2NameForService(appId, "default");
}

export function pm2NameForService(appId: string, serviceName: string): string {
  return `pmploy:${appId}:${serviceName}`;
}
```

- [ ] **Step 4: Run tests**

Run: `bun test apps/api/src/services/pm2.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/pm2.ts apps/api/src/services/pm2.test.ts
git commit -m "feat(api): namespace PM2 process names by service"
```

---

## Task 5: Ecosystem file parser — types and detection

**Files:**
- Create: `apps/api/src/services/ecosystem.ts`

- [ ] **Step 1: Write the types and detection helper**

Create `apps/api/src/services/ecosystem.ts`:

```ts
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
```

- [ ] **Step 2: Commit (parser comes next, but commit the boundary now)**

```bash
git add apps/api/src/services/ecosystem.ts
git commit -m "feat(api): add ecosystem file detection helper"
```

---

## Task 6: Ecosystem parser — implementation + tests

**Files:**
- Modify: `apps/api/src/services/ecosystem.ts`
- Create: `apps/api/src/services/ecosystem.test.ts`
- Create: `apps/api/src/services/__fixtures__/ecosystem.valid.cjs`
- Create: `apps/api/src/services/__fixtures__/ecosystem.invalid.cjs`
- Create: `apps/api/src/services/__fixtures__/ecosystem.duplicate.cjs`

- [ ] **Step 1: Write the fixtures**

Create `apps/api/src/services/__fixtures__/ecosystem.valid.cjs`:

```js
module.exports = {
  apps: [
    {
      name: "web",
      script: "./build/index.js",
      env: { PORT: "3000", NODE_ENV: "production" },
    },
    {
      name: "worker",
      script: "./build/worker.js",
      instances: 2,
      exec_mode: "cluster",
    },
  ],
};
```

Create `apps/api/src/services/__fixtures__/ecosystem.invalid.cjs`:

```js
module.exports = {
  // No `apps` key — should be rejected.
  somethingElse: true,
};
```

Create `apps/api/src/services/__fixtures__/ecosystem.duplicate.cjs`:

```js
module.exports = {
  apps: [
    { name: "web", script: "./a.js" },
    { name: "web", script: "./b.js" },
  ],
};
```

- [ ] **Step 2: Write the failing tests**

Create `apps/api/src/services/ecosystem.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to confirm it fails**

Run: `bun test apps/api/src/services/ecosystem.test.ts`
Expected: FAIL — `parseEcosystem` is not exported.

- [ ] **Step 4: Implement `parseEcosystem`**

Append to `apps/api/src/services/ecosystem.ts`:

```ts
import { readFile } from "node:fs/promises";

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
  const code = await runStreaming(
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

// PARSE_TIMEOUT_MS retained for a future Promise.race wrap; runStreaming
// itself currently has no timeout, but in deploy we will wrap the call.
export const ECOSYSTEM_PARSE_TIMEOUT_MS = PARSE_TIMEOUT_MS;
```

- [ ] **Step 5: Run tests**

Run: `bun test apps/api/src/services/ecosystem.test.ts`
Expected: 5 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/ecosystem.ts apps/api/src/services/ecosystem.test.ts apps/api/src/services/__fixtures__/
git commit -m "feat(api): parse ecosystem.config.{cjs,js,json}"
```

---

## Task 7: Service reconciliation

**Files:**
- Create: `apps/api/src/services/appServices.ts`
- Create: `apps/api/src/services/appServices.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/appServices.test.ts`:

```ts
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
    expect(out.services[1].isPrimary).toBe(false);
    expect(out.removed).toEqual([]);
  });

  test("preserves user port and isPrimary overrides on existing services", () => {
    const existing: PersistedService[] = [
      { name: "web", pm2Name: `pmploy:${appId}:web`, port: 9999, isPrimary: false },
      { name: "worker", pm2Name: `pmploy:${appId}:worker`, port: null, isPrimary: true },
    ];
    const out = reconcileServices(appId, existing, [ecoApp("web", 3000), ecoApp("worker")]);
    expect(out.services[0].port).toBe(9999);
    expect(out.services[1].isPrimary).toBe(true);
    expect(out.services[0].isPrimary).toBe(false);
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
```

- [ ] **Step 2: Run to confirm it fails**

Run: `bun test apps/api/src/services/appServices.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `reconcileServices`**

Create `apps/api/src/services/appServices.ts`:

```ts
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
  if (services.length > 0 && !services.some((s) => s.isPrimary)) {
    services[0].isPrimary = true;
  }

  return { services, removed };
}
```

- [ ] **Step 4: Run tests**

Run: `bun test apps/api/src/services/appServices.test.ts`
Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/appServices.ts apps/api/src/services/appServices.test.ts
git commit -m "feat(api): reconcile ecosystem services against persisted overrides"
```

---

## Task 8: Wire ecosystem detection into the deploy flow

**Files:**
- Modify: `apps/api/src/services/deploy.ts`

- [ ] **Step 1: Extract a helper `startServices` and call it from `deployFromGithub`**

Open `apps/api/src/services/deploy.ts`. Find the existing block (lines 210–238) that runs `install`, `build`, and `startApp`. Replace it with:

```ts
  const buildDir = gh.rootDir
    ? path.resolve(workdir, gh.rootDir)
    : workdir;

  // Install + build
  const installCmd = detectInstallCommand(buildDir);
  await ctx.log(`▶ install: ${installCmd}`);
  const installCode = await runShell(installCmd, {
    cwd: buildDir,
    onLine: (l) => ctx.log(l).catch(() => undefined),
  });
  if (installCode !== 0) throw new Error(`install exited with code ${installCode}`);

  if (gh.buildCommand && gh.buildCommand.trim()) {
    await ctx.log(`▶ build: ${gh.buildCommand}`);
    const buildCode = await runShell(gh.buildCommand, {
      cwd: buildDir,
      onLine: (l) => ctx.log(l).catch(() => undefined),
    });
    if (buildCode !== 0) throw new Error(`build exited with code ${buildCode}`);
  }

  // Switch the live cwd to the new deployment dir before (re)starting PM2.
  app.cwd = buildDir;
  await app.save();

  await startServices(app, ctx);
}
```

Replace the existing `startApp` function (lines 240–261) with:

```ts
async function startServices(app: AppDoc, ctx: LogContext): Promise<void> {
  const ecoPath = findEcosystemFile(app.cwd);
  if (ecoPath) {
    await ctx.log(`▶ detected ecosystem file: ${path.relative(app.cwd, ecoPath)}`);
    const parsed = await parseEcosystem(ecoPath);
    const existing = (app.services ?? []).map((s) => ({
      name: s.name,
      pm2Name: s.pm2Name,
      port: s.port ?? null,
      isPrimary: !!s.isPrimary,
    }));
    const { services, removed } = reconcileServices(String(app._id), existing, parsed.apps);

    // Backwards-compat: on the first deploy after this upgrade, the old
    // single-process name might still be alive.
    await deleteProcess(`pmploy:${String(app._id)}`).catch(() => undefined);

    const userEnv = await getDecryptedEnv(String(app._id));
    for (const svc of services) {
      const eco = parsed.apps.find((a) => a.name === svc.name);
      if (!eco) continue;
      await ctx.log(`▶ launching service ${svc.name} (${svc.pm2Name})`);
      const env: Record<string, string> = {
        ...userEnv,
        ...(eco.env ?? {}),
      };
      if (svc.port !== null) env.PORT = String(svc.port);
      const info = await startProcess({
        name: svc.pm2Name,
        cwd: eco.cwd ? path.resolve(app.cwd, eco.cwd) : app.cwd,
        script: eco.script,
        interpreter: eco.interpreter,
        args: eco.args,
        instances: eco.instances ?? 1,
        execMode: eco.execMode ?? "fork",
        env,
      });
      await ctx.log(`  pm2 status: ${info.status}, pid ${info.pid}`);
    }

    for (const gone of removed) {
      await ctx.log(`▶ tearing down removed service ${gone.name}`);
      await deleteProcess(gone.pm2Name).catch(() => undefined);
    }

    app.services = services;
    await app.save();
    return;
  }

  // Single-process fallback. Materialized into a single "default" service so
  // the rest of the system can treat all apps uniformly.
  const defaultName = pm2NameForApp(String(app._id));
  // Tear down the legacy un-suffixed process if it still exists.
  await deleteProcess(`pmploy:${String(app._id)}`).catch(() => undefined);

  const userEnv = await getDecryptedEnv(String(app._id));
  await ctx.log(`▶ launching ${app.script} (${defaultName})`);
  const info = await startProcess({
    name: defaultName,
    cwd: app.cwd,
    script: app.script,
    interpreter: app.interpreter || undefined,
    instances: app.instances ?? 1,
    execMode: app.execMode,
    env: { ...userEnv, PORT: String(app.port ?? "") },
  });
  await ctx.log(`  pm2 status: ${info.status}, pid ${info.pid}`);

  // Tear down any prior multi-service processes that no longer apply.
  for (const gone of app.services ?? []) {
    if (gone.pm2Name === defaultName) continue;
    await deleteProcess(gone.pm2Name).catch(() => undefined);
  }

  app.services = [
    {
      name: "default",
      pm2Name: defaultName,
      port: app.port ?? null,
      isPrimary: true,
    },
  ];
  await app.save();

  await new Promise((r) => setTimeout(r, 250));
  const after = await describeProcess(defaultName).catch(() => null);
  if (after && after.status !== "online") {
    throw new Error(`pm2 process not online (status ${after.status})`);
  }
}
```

Also update `deployLocal` (the previous lines 134–143) to use `startServices` instead of `startApp`:

```ts
async function deployLocal(
  app: AppDoc,
  dep: DepDoc,
  ctx: LogContext,
): Promise<void> {
  if (!app.cwd) throw new Error("local app has no working directory configured");
  await ctx.log(`▶ launching app in ${app.cwd}`);
  await startServices(app, ctx);
  dep.workdir = app.cwd;
}
```

- [ ] **Step 2: Add the new imports at the top of deploy.ts**

In the imports block, add:

```ts
import { findEcosystemFile, parseEcosystem } from "./ecosystem.ts";
import { reconcileServices } from "./appServices.ts";
```

- [ ] **Step 3: Typecheck**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS for deploy.ts; remaining errors are in routes (covered next tasks).

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/deploy.ts
git commit -m "feat(api): deploy each ecosystem service as a namespaced PM2 process"
```

---

## Task 9: Update routing — `resyncDomains` and Domain attach

**Files:**
- Modify: `apps/api/src/services/deploy.ts`
- Modify: `apps/api/src/routes/domains.ts`

- [ ] **Step 1: Update `resyncDomains` to route per-service**

In `apps/api/src/services/deploy.ts`, locate the existing `resyncDomains` function (currently around lines 275–297) and replace it with:

```ts
async function resyncDomains(
  appId: string,
  _fallbackPort: number | null,
  ctx: LogContext,
): Promise<void> {
  const app = await Application.findById(appId);
  if (!app) return;
  const services = app.services ?? [];
  const domains = await Domain.find({ appId: new Types.ObjectId(appId) });
  if (domains.length === 0) return;
  for (const d of domains) {
    try {
      const target = pickTargetService(services, d.serviceName ?? "");
      if (!target || !target.port) {
        d.sslStatus = "error";
        d.lastError = target
          ? `service "${target.name}" has no port`
          : `service "${d.serviceName || "(primary)"}" not found`;
        await d.save();
        await ctx.log(`✗ caddy sync skipped for ${d.host}: ${d.lastError}`);
        continue;
      }
      await caddy.upsertDomain(d.host, target.port);
      d.sslStatus = "active";
      d.lastError = "";
      await d.save();
      await ctx.log(`▶ caddy: ${d.host} -> 127.0.0.1:${target.port} (${target.name})`);
    } catch (err) {
      d.sslStatus = "error";
      d.lastError = err instanceof Error ? err.message : String(err);
      await d.save();
      await ctx.log(`✗ caddy sync failed for ${d.host}: ${d.lastError}`);
    }
  }
}

function pickTargetService(
  services: { name: string; port: number | null; isPrimary: boolean }[],
  serviceName: string,
): { name: string; port: number | null } | null {
  if (serviceName) {
    return services.find((s) => s.name === serviceName) ?? null;
  }
  return services.find((s) => s.isPrimary) ?? services[0] ?? null;
}
```

The single call site (around line 114) passes `app.port` but `resyncDomains` now uses `app.services`; the parameter is kept for signature compatibility but ignored.

- [ ] **Step 2: Update Domain attach to accept `serviceName`**

In `apps/api/src/routes/domains.ts`, replace the entire body of the `view` function and the `POST /teams/:teamId/apps/:appId/domains` handler:

```ts
function view(d: DomainDoc): PublicDomain {
  return {
    id: String(d._id),
    appId: String(d.appId),
    teamId: String(d.teamId),
    host: d.host,
    sslStatus: d.sslStatus,
    lastError: d.lastError ?? "",
    serviceName: d.serviceName ?? "",
    createdAt: (d as DomainDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (d as DomainDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}
```

And replace the existing `POST` handler with:

```ts
route.post(
  "/teams/:teamId/apps/:appId/domains",
  requireTeamRole("member"),
  zValidator("json", AttachDomainInputSchema),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const { host, serviceName } = c.req.valid("json");

    const services = app.services ?? [];
    if (services.length === 0 && !app.port) {
      return c.json(
        { error: "app_has_no_port", message: "deploy the app before attaching a domain" },
        409,
      );
    }
    if (serviceName && !services.some((s) => s.name === serviceName)) {
      return c.json({ error: "unknown_service", message: `no service named "${serviceName}"` }, 400);
    }
    const target = serviceName
      ? services.find((s) => s.name === serviceName) ?? null
      : services.find((s) => s.isPrimary) ?? services[0] ?? null;
    const targetPort = target?.port ?? app.port ?? null;
    if (!targetPort) {
      return c.json(
        { error: "service_has_no_port", message: `service "${serviceName || "(primary)"}" has no port` },
        409,
      );
    }

    const existing = await Domain.findOne({ host }).lean();
    if (existing) {
      if (String(existing.appId) === String(app._id)) {
        return c.json(view(existing as unknown as DomainDoc));
      }
      return c.json({ error: "domain already attached to another app" }, 409);
    }

    const dom = await Domain.create({
      host,
      appId: app._id,
      teamId: app.teamId,
      sslStatus: "pending",
      serviceName: serviceName || "",
    });

    try {
      await caddy.upsertDomain(host, targetPort);
      dom.sslStatus = "active";
      dom.lastError = "";
      await dom.save();
    } catch (err) {
      dom.sslStatus = "error";
      dom.lastError = err instanceof Error ? err.message : String(err);
      await dom.save();
    }
    const user = c.get("user");
    await recordAudit({
      teamId: String(app.teamId),
      userId: user.id,
      userEmail: user.email,
      action: "domain.attach",
      target: { type: "domain", id: String(dom._id), label: dom.host },
      meta: { appId: String(app._id), appName: app.name, serviceName: dom.serviceName },
    });
    return c.json(view(dom), 201);
  },
);
```

And replace the retry handler with one that resolves the port via the service list:

```ts
route.post(
  "/teams/:teamId/apps/:appId/domains/:domainId/retry",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const id = c.req.param("domainId");
    if (!Types.ObjectId.isValid(id)) return c.json({ error: "not found" }, 404);
    const dom = await Domain.findOne({ _id: new Types.ObjectId(id), appId: app._id });
    if (!dom) return c.json({ error: "not found" }, 404);

    const services = app.services ?? [];
    const target = dom.serviceName
      ? services.find((s) => s.name === dom.serviceName) ?? null
      : services.find((s) => s.isPrimary) ?? services[0] ?? null;
    const targetPort = target?.port ?? app.port ?? null;
    if (!targetPort) {
      return c.json({ error: "app_has_no_port" }, 409);
    }

    try {
      await caddy.upsertDomain(dom.host, targetPort);
      dom.sslStatus = "active";
      dom.lastError = "";
      await dom.save();
    } catch (err) {
      dom.sslStatus = "error";
      dom.lastError = err instanceof Error ? err.message : String(err);
      await dom.save();
    }
    return c.json(view(dom));
  },
);
```

- [ ] **Step 3: Typecheck**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS for deploy.ts and domains.ts.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/deploy.ts apps/api/src/routes/domains.ts
git commit -m "feat(api): per-service domain routing"
```

---

## Task 10: Update apps route — services in view + lifecycle iterates services

**Files:**
- Modify: `apps/api/src/routes/apps.ts`

- [ ] **Step 1: Update `applicationView` and add `safeDescribeServices`**

In `apps/api/src/routes/apps.ts`, replace `applicationView` and `safeDescribe` with:

```ts
async function safeDescribe(name: string): Promise<Pm2Info | null> {
  try {
    return await describeProcess(name);
  } catch {
    return null;
  }
}

async function describeServices(
  app: ApplicationDoc,
): Promise<{ name: string; pm2Name: string; port: number | null; isPrimary: boolean; pm2: Pm2Info | null }[]> {
  const list = app.services ?? [];
  return Promise.all(
    list.map(async (s) => ({
      name: s.name,
      pm2Name: s.pm2Name,
      port: s.port ?? null,
      isPrimary: !!s.isPrimary,
      pm2: await safeDescribe(s.pm2Name),
    })),
  );
}

function aggregateStatus(
  current: ApplicationDoc["status"],
  services: { pm2: Pm2Info | null }[],
): ApplicationDoc["status"] {
  if (services.length === 0) return current;
  const statuses = services.map((s) => s.pm2?.status ?? "unknown");
  if (statuses.every((s) => s === "online")) return "running";
  if (statuses.some((s) => s === "errored")) return "errored";
  if (statuses.every((s) => s === "stopped")) return "stopped";
  return "degraded";
}

async function applicationView(
  app: ApplicationDoc,
): Promise<PublicApplication> {
  const services = await describeServices(app);
  const primary = services.find((s) => s.isPrimary) ?? services[0] ?? null;
  return {
    id: String(app._id),
    teamId: String(app.teamId),
    name: app.name,
    slug: app.slug,
    sourceType: app.sourceType,
    cwd: app.cwd ?? "",
    script: app.script,
    interpreter: app.interpreter ?? "",
    instances: app.instances ?? 1,
    execMode: app.execMode,
    github: app.github
      ? {
          installationId: app.github.installationId,
          repo: app.github.repo,
          branch: app.github.branch,
          rootDir: app.github.rootDir ?? "",
          buildCommand: app.github.buildCommand ?? "",
        }
      : null,
    port: app.port ?? null,
    status: aggregateStatus(app.status, services),
    pm2Name: app.pm2Name,
    pm2: primary?.pm2 ?? null,
    services,
    createdAt: (app as ApplicationDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (app as ApplicationDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}
```

- [ ] **Step 2: Update list/get/update/start/stop/restart/delete handlers to use the new async `applicationView`**

In the same file, replace every call site of `applicationView(app, pm2)` with `await applicationView(app)`. Specifically the following lines need to change:

- The list handler (`GET /teams/:teamId/apps`) — replace the `Promise.all(apps.map(...))` block with:

  ```ts
  const enriched = await Promise.all(
    apps.map((a) => applicationView(a as ApplicationDoc)),
  );
  ```

  and remove the `safeDescribe` call that was there.

- The create handler (`POST /teams/:teamId/apps`) — replace `return c.json(applicationView(app, null), 201);` with `return c.json(await applicationView(app), 201);`.
- The get handler (`GET /teams/:teamId/apps/:appId`) — replace the final block with `return c.json(await applicationView(app));`.
- The update handler (`PATCH /teams/:teamId/apps/:appId`) — replace the final block with `return c.json(await applicationView(app));`.
- The start handler — change the return after a successful start to `return c.json(await applicationView(app));`; for the error path: `return c.json({ error: "pm2_start_failed", message: (err as Error).message }, 500);` (unchanged).
- The stop and restart handlers — similar swap to `await applicationView(app)`.

- [ ] **Step 3: Update start/stop/restart/delete to iterate services**

Replace the start handler body with one that iterates `app.services`:

```ts
route.post(
  "/teams/:teamId/apps/:appId/start",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    if (!app.cwd) {
      return c.json(
        {
          error: "not_deployed",
          message:
            "this app has no working directory yet; deploy it from GitHub first",
        },
        409,
      );
    }
    const services = app.services ?? [];
    if (services.length === 0) {
      return c.json({ error: "no_services", message: "this app has no services to start; redeploy" }, 409);
    }
    try {
      app.status = "deploying";
      await app.save();
      const userEnv = await getDecryptedEnv(String(app._id));
      for (const svc of services) {
        await startProcess({
          name: svc.pm2Name,
          cwd: app.cwd,
          script: app.script, // for the synthetic "default" service
          interpreter: app.interpreter || undefined,
          instances: app.instances ?? 1,
          execMode: app.execMode,
          env: { ...userEnv, PORT: String(svc.port ?? "") },
        });
      }
      app.status = "running";
      await app.save();
      return c.json(await applicationView(app));
    } catch (err) {
      app.status = "errored";
      await app.save();
      return c.json(
        { error: "pm2_start_failed", message: (err as Error).message },
        500,
      );
    }
  },
);
```

Note: For multi-service apps, **start** via this endpoint is a coarse fallback — it can re-start each service using PM2's last-known config (PM2 retains it), but `script` is only meaningful for the `default` synthetic service. For full restart with re-parsed ecosystem, users should redeploy. Document this in PRODUCTION.md (see Task 13).

Replace stop and restart handlers to iterate:

```ts
route.post(
  "/teams/:teamId/apps/:appId/stop",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    try {
      for (const svc of app.services ?? []) {
        await stopProcess(svc.pm2Name).catch(() => undefined);
      }
      app.status = "stopped";
      await app.save();
      return c.json(await applicationView(app));
    } catch (err) {
      return c.json(
        { error: "pm2_stop_failed", message: (err as Error).message },
        500,
      );
    }
  },
);

route.post(
  "/teams/:teamId/apps/:appId/restart",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    try {
      for (const svc of app.services ?? []) {
        await restartProcess(svc.pm2Name).catch(() => undefined);
      }
      return c.json(await applicationView(app));
    } catch (err) {
      return c.json(
        { error: "pm2_restart_failed", message: (err as Error).message },
        500,
      );
    }
  },
);
```

Replace the delete handler so it tears down all services:

```ts
route.delete(
  "/teams/:teamId/apps/:appId",
  requireTeamRole("admin"),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const domains = await Domain.find({ appId: app._id });
    for (const d of domains) {
      await caddy.removeDomain(d.host).catch(() => undefined);
      await d.deleteOne();
    }
    for (const svc of app.services ?? []) {
      await deleteProcess(svc.pm2Name).catch(() => undefined);
    }
    // Legacy: also nuke the pre-namespacing process name if it ever existed.
    await deleteProcess(`pmploy:${String(app._id)}`).catch(() => undefined);
    await app.deleteOne();
    const user = c.get("user");
    await recordAudit({
      teamId: String(app.teamId),
      userId: user.id,
      userEmail: user.email,
      action: "app.delete",
      target: { type: "app", id: String(app._id), label: app.name },
    });
    return c.json({ ok: true });
  },
);
```

- [ ] **Step 4: Typecheck**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS.

- [ ] **Step 5: Run the existing API tests to catch regressions**

Run: `bun test apps/api/src`
Expected: All existing tests pass (the multi-process changes are additive).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/apps.ts
git commit -m "feat(api): aggregate status + iterate services for lifecycle ops"
```

---

## Task 11: Runtime log tailing — `processLogs.ts`

**Files:**
- Create: `apps/api/src/services/processLogs.ts`
- Create: `apps/api/src/services/processLogs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `apps/api/src/services/processLogs.test.ts`:

```ts
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tailProcessLogs } from "./processLogs.ts";

async function makeLogDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pmploy-logs-"));
}

describe("tailProcessLogs", () => {
  test("emits the tail of an existing log file then watches for new lines", async () => {
    const dir = await makeLogDir();
    const out = path.join(dir, "svc-out.log");
    const err = path.join(dir, "svc-error.log");
    await writeFile(out, "line1\nline2\n");
    await writeFile(err, "");

    const collected: { stream: "stdout" | "stderr"; line: string }[] = [];
    const abort = new AbortController();

    const consumer = (async () => {
      for await (const ev of tailProcessLogs({
        stdoutPath: out,
        stderrPath: err,
        signal: abort.signal,
        tailLines: 10,
      })) {
        collected.push(ev);
        if (collected.length >= 3) {
          abort.abort();
          break;
        }
      }
    })();

    // Allow the head emit to happen, then append a new line.
    await new Promise((r) => setTimeout(r, 50));
    await appendFile(out, "line3\n");

    await consumer;
    expect(collected.map((e) => e.line)).toEqual(["line1", "line2", "line3"]);
    expect(collected.every((e) => e.stream === "stdout")).toBe(true);
  });

  test("emits nothing for missing files but does not throw", async () => {
    const abort = new AbortController();
    const events: unknown[] = [];
    const consumer = (async () => {
      for await (const ev of tailProcessLogs({
        stdoutPath: "/tmp/does-not-exist-1.log",
        stderrPath: "/tmp/does-not-exist-2.log",
        signal: abort.signal,
        tailLines: 10,
      })) {
        events.push(ev);
      }
    })();
    setTimeout(() => abort.abort(), 50);
    await consumer;
    expect(events).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `bun test apps/api/src/services/processLogs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the tailer**

Create `apps/api/src/services/processLogs.ts`:

```ts
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

export type LogEvent = { stream: "stdout" | "stderr"; line: string };

export type TailOptions = {
  stdoutPath: string;
  stderrPath: string;
  tailLines?: number;
  signal?: AbortSignal;
};

/**
 * Stream new lines appended to a pair of PM2 log files. On first iterate,
 * yields the last `tailLines` lines from each existing file (newest at the end).
 * Then watches both files and yields new lines as they arrive. Stops cleanly
 * when the signal is aborted.
 */
export async function* tailProcessLogs(opts: TailOptions): AsyncIterable<LogEvent> {
  const tail = opts.tailLines ?? 200;

  // Snapshot the existing tail of each file.
  for (const [stream, file] of [
    ["stdout", opts.stdoutPath] as const,
    ["stderr", opts.stderrPath] as const,
  ]) {
    if (!existsSync(file)) continue;
    const content = await readFile(file, "utf-8");
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const slice = lines.slice(Math.max(0, lines.length - tail));
    for (const line of slice) yield { stream, line };
  }

  // Watch both files for appended content.
  const offsets = new Map<string, number>();
  for (const file of [opts.stdoutPath, opts.stderrPath]) {
    offsets.set(file, existsSync(file) ? (await readFile(file)).length : 0);
  }

  const queue: LogEvent[] = [];
  let resolve: (() => void) | null = null;
  const wake = () => {
    resolve?.();
    resolve = null;
  };

  const watchers = [
    watchFile(opts.stdoutPath, "stdout"),
    watchFile(opts.stderrPath, "stderr"),
  ];

  function watchFile(file: string, stream: "stdout" | "stderr") {
    if (!existsSync(path.dirname(file))) return { close: () => {} };
    try {
      const w = watch(file, { persistent: false }, async () => {
        try {
          const buf = await readFile(file);
          const prev = offsets.get(file) ?? 0;
          if (buf.length <= prev) {
            // File truncated/rotated — reset.
            offsets.set(file, buf.length);
            return;
          }
          const chunk = buf.subarray(prev).toString("utf-8");
          offsets.set(file, buf.length);
          const lines = chunk.split("\n");
          if (lines.at(-1) === "") lines.pop();
          for (const line of lines) queue.push({ stream, line });
          wake();
        } catch {
          // best-effort
        }
      });
      return w;
    } catch {
      return { close: () => {} };
    }
  }

  try {
    while (!opts.signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((r) => {
        resolve = r;
        opts.signal?.addEventListener("abort", () => {
          wake();
        }, { once: true });
      });
    }
  } finally {
    for (const w of watchers) {
      try {
        (w as { close?: () => void }).close?.();
      } catch {
        // ignore
      }
    }
  }
}

/** Resolve the conventional PM2 log file paths for a process name. */
export function pm2LogPaths(pm2Name: string): { stdout: string; stderr: string } {
  const home = process.env.HOME ?? "";
  return {
    stdout: path.join(home, ".pm2", "logs", `${pm2Name}-out.log`),
    stderr: path.join(home, ".pm2", "logs", `${pm2Name}-error.log`),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `bun test apps/api/src/services/processLogs.test.ts`
Expected: 2 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/processLogs.ts apps/api/src/services/processLogs.test.ts
git commit -m "feat(api): tail per-process PM2 log files"
```

---

## Task 12: SSE log endpoint

**Files:**
- Modify: `apps/api/src/routes/apps.ts`

- [ ] **Step 1: Add the imports**

At the top of `apps/api/src/routes/apps.ts`, add to the existing imports:

```ts
import { tailProcessLogs, pm2LogPaths } from "../services/processLogs.ts";
```

- [ ] **Step 2: Add the SSE handler**

Just above `export default route;` at the bottom of the file, insert:

```ts
route.get(
  "/teams/:teamId/apps/:appId/services/:serviceName/logs",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const svc = (app.services ?? []).find((s) => s.name === c.req.param("serviceName"));
    if (!svc) return c.json({ error: "service not found" }, 404);

    const { stdout, stderr } = pm2LogPaths(svc.pm2Name);
    const abort = new AbortController();
    c.req.raw.signal.addEventListener("abort", () => abort.abort(), { once: true });

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const enc = new TextEncoder();
        try {
          for await (const ev of tailProcessLogs({
            stdoutPath: stdout,
            stderrPath: stderr,
            signal: abort.signal,
            tailLines: 200,
          })) {
            controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
          }
        } finally {
          controller.close();
        }
      },
      cancel() {
        abort.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  },
);
```

- [ ] **Step 3: Typecheck**

Run: `bun --filter @pmploy/api typecheck`
Expected: PASS.

- [ ] **Step 4: Smoke test the route exists**

Run: `bun test apps/api/src` (any existing route smoke tests should still pass).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/apps.ts
git commit -m "feat(api): SSE endpoint for per-service runtime logs"
```

---

## Task 13: PRODUCTION.md update

**Files:**
- Modify: `docs/PRODUCTION.md`

- [ ] **Step 1: Add a multi-process section**

Append to `docs/PRODUCTION.md`:

```markdown
## Multi-Process Apps

If your repository contains an `ecosystem.config.{cjs,js,json}` in the build directory, pmPloy treats it as a multi-process app. Each app declared in the file is started as a separate PM2 process named `pmploy:<appId>:<serviceName>`. Implications:

- Outside pmPloy, `pm2 list` will show the namespaced names — `pmploy:64aabb...:web` rather than `web`. This is intentional to prevent collisions between apps.
- Service names must match `/^[A-Za-z0-9._-]+$/`. Whitespace, colons, and other PM2-unfriendly characters are rejected at deploy time.
- Per-service ports default to `process.env.PORT` from the ecosystem file. You can override the port for any service in the pmPloy UI; the override persists across deploys.
- When attaching a domain, you can pin it to a specific service. Leave blank to route to the designated **primary** service.
- The `Start` button in the pmPloy UI is a coarse fallback that only re-runs PM2's last known config per service. For changes to the ecosystem file, redeploy.
- PM2 log rotation is not managed by pmPloy. If you rely on long-running services, configure `pm2 install pm2-logrotate` or external logrotate.
```

- [ ] **Step 2: Commit**

```bash
git add docs/PRODUCTION.md
git commit -m "docs: document multi-process apps"
```

---

## Task 14: End-to-end smoke

**Files:** none (manual verification).

- [ ] **Step 1: Run the full test suite**

Run: `bun --filter '*' test`
Expected: all tests pass.

- [ ] **Step 2: Run typecheck across the workspace**

Run: `bun --filter '*' typecheck`
Expected: PASS.

- [ ] **Step 3: Sanity check the diff**

Run: `git log --oneline origin/main..HEAD`
Expected: 13 commits, one per task, with descriptive messages.

- [ ] **Step 4: Push and self-deploy via pmPloy**

```bash
git push origin <branch>
```

Then trigger the pmPloy self-update on the test server. Verify:

1. The update completes without errors.
2. Deploy your `chat.saidulbadhon.com` app (which has the 3-service ecosystem). Observe in the deploy log:
   - `▶ detected ecosystem file: ecosystem.config.cjs`
   - Three `▶ launching service <name> (pmploy:<appId>:<name>)` lines.
3. `pm2 list` on the server shows three `pmploy:<appId>:<name>` entries.
4. `GET /teams/:teamId/apps/:appId` returns a `services` array with three entries; one has `isPrimary: true`.
5. `GET /teams/:teamId/apps/:appId/services/<name>/logs` streams SSE events as the service writes output.
6. Adding a domain with `serviceName: "<name>"` routes Caddy to that service's port (check `curl https://<host>`).

---

## Self-Review

### Spec coverage

- Application schema with `services` subdoc → Task 1 ✓
- Domain `serviceName` → Task 2 ✓
- Shared schemas (`PublicService`, updated `PublicApplication`, `PublicDomain`) → Task 3 ✓
- PM2 naming (`pmploy:<appId>:<serviceName>`, including `default`) → Task 4 ✓
- Ecosystem detection + parsing (.cjs/.js/.json, errors, timeouts) → Tasks 5, 6 ✓
- Reconciliation preserving overrides → Task 7 ✓
- Deploy: detect → parse → reconcile → start each service → teardown removed → save → Task 8 ✓
- Legacy single-process path + migration teardown of old `pmploy:<appId>` → Task 8 ✓
- Per-service domain routing (`resyncDomains`, attach, retry) → Task 9 ✓
- Status aggregation + lifecycle iterating services → Task 10 ✓
- Runtime log tailer + SSE endpoint → Tasks 11, 12 ✓
- PRODUCTION.md note about namespacing + naming rules → Task 13 ✓
- Smoke verification → Task 14 ✓

### Placeholder scan

No TBDs, TODOs, or vague "handle edge cases" steps. Every step has the exact code or command.

### Type consistency

- `PersistedService` in `appServices.ts` matches the `services` subdoc fields (name, pm2Name, port, isPrimary).
- `EcosystemApp` is consumed only by `reconcileServices` and `startServices`; both reference `name`, `script`, `port`, `env`, `cwd`, `interpreter`, `instances`, `execMode`, `args` — all defined in Task 5/6.
- `tailProcessLogs` signature is consistent between definition (Task 11) and use (Task 12): `{ stdoutPath, stderrPath, signal, tailLines }`.
- `applicationView` returns `Promise<PublicApplication>` after Task 10; all callers `await` it.

### Scope check

This plan is the **API layer only**. UI changes (services panel, log viewer, domain dropdown) are deliberately deferred to a follow-up plan that will reference this one. That keeps the diff reviewable and lets us ship and validate the backend before painting UI on top.

### Ambiguity check

- The `status` field gains a new enum value `"degraded"`. Anywhere that pattern-matches against the previous five values needs review — only `Application.ts`, `aggregateStatus`, and the shared schema reference it; all are updated.
- Single-process apps materialize a synthetic `default` service on first deploy after upgrade. Subsequent reads see `services.length === 1` and treat that as the primary uniformly.
