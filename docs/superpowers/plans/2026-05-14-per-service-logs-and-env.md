# Per-Service Logs and Env Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users see and manage each service in a multi-process app individually — list services on the app page, drill into a service page with live logs and a per-service env editor that layers under the existing app-level (shared) env vars.

**Architecture:** Backend gets an optional `serviceName` field on `EnvVar` (`""` = shared), three new routes scoped to a service, and a deploy-flow update so each service's env is `shared + service-overrides`. Frontend gets a Services card on the app page (one row per `app.services[]`) and a new `/apps/:appId/services/:serviceName` page with a live SSE log stream and a service-scoped env card. The per-service SSE log endpoint already exists.

**Tech Stack:** Bun + Hono + Mongoose on the API. React + react-router-dom + Tailwind on the web. `bun test` for tests. Zod schemas in `@pmploy/shared`.

**Spec reference:** [docs/superpowers/specs/2026-05-14-per-service-logs-and-env-design.md](../specs/2026-05-14-per-service-logs-and-env-design.md)

---

## File Map

**Backend (modify):**
- `apps/api/src/models/EnvVar.ts` — add `serviceName` field, swap unique index.
- `apps/api/src/services/envVars.ts` — `getDecryptedEnv(appId, serviceName)` merges shared + overrides.
- `apps/api/src/routes/env.ts` — three new service-scoped routes.
- `apps/api/src/services/deploy.ts` — pass `svc.name` to `getDecryptedEnv` in both branches of `startServices`.

**Backend (create):**
- `apps/api/src/services/envVars.test.ts` — unit tests for merge order.

**Shared (modify):**
- `packages/shared/src/schemas.ts` — add `serviceName` to `PublicEnvVarSchema`.

**Frontend (modify):**
- `apps/web/src/App.tsx` — register the service route.
- `apps/web/src/pages/AppDetailPage.tsx` — render `<ServicesCard>`, hide aggregate Process card when multi-service.
- `apps/web/src/components/EnvVarsCard.tsx` — add `scope` prop.

**Frontend (create):**
- `apps/web/src/components/ServicesCard.tsx` — list of services with status, port, links.
- `apps/web/src/pages/ServiceDetailPage.tsx` — service page (header, process card, logs, env, shared-read-only).
- `apps/web/src/components/ServiceLogStream.tsx` — SSE log streaming with stdout/stderr coloring.

---

## Task 1: Add `serviceName` to EnvVar model

**Files:**
- Modify: `apps/api/src/models/EnvVar.ts`

- [ ] **Step 1: Update the schema and unique index**

Replace the entire contents of `apps/api/src/models/EnvVar.ts` with:

```ts
import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const envVarSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    appId: { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    serviceName: { type: String, default: "" },
    key: { type: String, required: true, trim: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { timestamps: true },
);

envVarSchema.index({ appId: 1, serviceName: 1, key: 1 }, { unique: true });

export type EnvVarDoc = InferSchemaType<typeof envVarSchema> & {
  _id: Types.ObjectId;
};
export const EnvVar: Model<EnvVarDoc> = model<EnvVarDoc>("EnvVar", envVarSchema);
```

- [ ] **Step 2: Typecheck the API package**

Run: `cd apps/api && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/models/EnvVar.ts
git commit -m "feat(env): add serviceName field to EnvVar model"
```

---

## Task 2: Update `PublicEnvVarSchema` shared type

**Files:**
- Modify: `packages/shared/src/schemas.ts:336-343`

- [ ] **Step 1: Add `serviceName` to `PublicEnvVarSchema`**

In `packages/shared/src/schemas.ts`, replace the `PublicEnvVarSchema` block (lines 336-343) with:

```ts
export const PublicEnvVarSchema = z.object({
  id: z.string(),
  key: z.string(),
  serviceName: z.string(),
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type PublicEnvVar = z.infer<typeof PublicEnvVarSchema>;
```

- [ ] **Step 2: Typecheck shared package**

Run: `cd packages/shared && bun run typecheck`
Expected: no errors. (If `typecheck` script doesn't exist on shared, run `cd packages/shared && bunx tsc --noEmit` instead.)

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "feat(shared): add serviceName to PublicEnvVarSchema"
```

---

## Task 3: Layered env merge — TDD

**Files:**
- Create: `apps/api/src/services/envVars.test.ts`
- Modify: `apps/api/src/services/envVars.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/envVars.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import mongoose, { Types } from "mongoose";
import { EnvVar } from "../models/EnvVar.ts";
import { seal } from "./crypto.ts";
import { getDecryptedEnv } from "./envVars.ts";

const TEST_KEY = "ZmFrZS1mYWtlLWZha2UtZmFrZS1mYWtlLWZha2UtZmFrZS1mYWg="; // 32 base64 bytes

describe("getDecryptedEnv merge order", () => {
  const appId = new Types.ObjectId();
  const teamId = new Types.ObjectId();

  beforeEach(async () => {
    process.env.ENV_ENCRYPTION_KEY = TEST_KEY;
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect("mongodb://127.0.0.1:27017/pmploy-test-envvars");
    }
    await EnvVar.deleteMany({ appId });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await EnvVar.deleteMany({ appId });
      await mongoose.disconnect();
    }
  });

  async function put(serviceName: string, key: string, value: string) {
    const sealed = seal(value);
    await EnvVar.create({
      teamId,
      appId,
      serviceName,
      key,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
    });
  }

  it("returns empty object when no rows exist", async () => {
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env).toEqual({});
  });

  it("returns shared values when no service overrides exist", async () => {
    await put("", "DATABASE_URL", "postgres://shared");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.DATABASE_URL).toBe("postgres://shared");
  });

  it("service override wins over shared for same key", async () => {
    await put("", "DATABASE_URL", "postgres://shared");
    await put("api", "DATABASE_URL", "postgres://api");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.DATABASE_URL).toBe("postgres://api");
  });

  it("other-service overrides do not leak", async () => {
    await put("worker", "WORKER_ONLY", "yes");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.WORKER_ONLY).toBeUndefined();
  });

  it("merges shared + service-specific keys", async () => {
    await put("", "SHARED", "s");
    await put("api", "API_ONLY", "a");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env).toEqual({ SHARED: "s", API_ONLY: "a" });
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails on the signature**

Run: `cd apps/api && bun test src/services/envVars.test.ts`
Expected: type or runtime failure because `getDecryptedEnv` is single-argument today.

- [ ] **Step 3: Update `getDecryptedEnv` to take a service name**

Replace the entire body of `apps/api/src/services/envVars.ts` with:

```ts
import { Types } from "mongoose";
import { EnvVar } from "../models/EnvVar.ts";
import { open, isEncryptionConfigured } from "./crypto.ts";

/**
 * Decrypt env vars for an app+service. Layers shared (serviceName: "")
 * underneath any service-specific overrides for `serviceName`. Returns an
 * empty object if encryption isn't configured.
 */
export async function getDecryptedEnv(
  appId: string,
  serviceName: string,
): Promise<Record<string, string>> {
  if (!isEncryptionConfigured()) return {};
  const rows = await EnvVar.find({
    appId: new Types.ObjectId(appId),
    serviceName: { $in: ["", serviceName] },
  }).lean();

  const shared: Record<string, string> = {};
  const override: Record<string, string> = {};
  for (const v of rows) {
    const bucket = v.serviceName === "" ? shared : override;
    try {
      bucket[v.key] = open({
        ciphertext: v.ciphertext,
        iv: v.iv,
        authTag: v.authTag,
      });
    } catch (err) {
      console.error(
        `[env] failed to decrypt ${v.key} for app ${appId} service "${v.serviceName}":`,
        err,
      );
    }
  }
  return { ...shared, ...override };
}
```

- [ ] **Step 4: Run the test, confirm it passes**

Run: `cd apps/api && bun test src/services/envVars.test.ts`
Expected: all 5 cases pass. Requires a local MongoDB running on `127.0.0.1:27017` (start with `brew services start mongodb-community` or equivalent). If the connect step throws `ECONNREFUSED`, start MongoDB and re-run — do not skip the test.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/envVars.ts apps/api/src/services/envVars.test.ts
git commit -m "feat(env): layered env merge - shared + service overrides"
```

---

## Task 4: Wire layered env into deploy

**Files:**
- Modify: `apps/api/src/services/deploy.ts:258` (multi-service branch) and `apps/api/src/services/deploy.ts:307` (single-process fallback)

- [ ] **Step 1: Pass service name to `getDecryptedEnv` in the multi-service loop**

In `apps/api/src/services/deploy.ts`, find the block starting around line 258:

```ts
    const userEnv = await getDecryptedEnv(String(app._id));
    for (const svc of services) {
      const eco = parsed.apps.find((a) => a.name === svc.name);
      if (!eco) continue;
      await ctx.log(`▶ launching service ${svc.name} (${svc.pm2Name})`);
      const env: Record<string, string> = {
        ...userEnv,
        ...(eco.env ?? {}),
      };
```

Replace with:

```ts
    for (const svc of services) {
      const eco = parsed.apps.find((a) => a.name === svc.name);
      if (!eco) continue;
      await ctx.log(`▶ launching service ${svc.name} (${svc.pm2Name})`);
      const userEnv = await getDecryptedEnv(String(app._id), svc.name);
      const env: Record<string, string> = {
        ...userEnv,
        ...(eco.env ?? {}),
      };
```

(The `userEnv` lookup moves inside the loop so each service gets its own merge.)

- [ ] **Step 2: Pass `"default"` in the single-process fallback**

Around line 307 of the same file, find:

```ts
  const userEnv = await getDecryptedEnv(String(app._id));
  await ctx.log(`▶ launching ${app.script} (${defaultName})`);
```

Replace with:

```ts
  const userEnv = await getDecryptedEnv(String(app._id), "default");
  await ctx.log(`▶ launching ${app.script} (${defaultName})`);
```

- [ ] **Step 3: Also update the start-app route, which uses `getDecryptedEnv`**

In `apps/api/src/routes/apps.ts` around line 272 (inside the `/start` handler), find:

```ts
      const userEnv = await getDecryptedEnv(String(app._id));
      const svc = services[0]!;
```

Replace with:

```ts
      const svc = services[0]!;
      const userEnv = await getDecryptedEnv(String(app._id), svc.name);
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/deploy.ts apps/api/src/routes/apps.ts
git commit -m "feat(deploy): merge per-service env overrides on launch"
```

---

## Task 5: Service-scoped env routes (backend)

**Files:**
- Modify: `apps/api/src/routes/env.ts`

- [ ] **Step 1: Add the three new routes**

Open `apps/api/src/routes/env.ts`. After the existing `route.delete("/teams/:teamId/apps/:appId/env/:key", …)` handler (after line 116, before `export default route;`), insert:

```ts
async function loadAppAndService(teamId: string, appId: string, serviceName: string) {
  const app = await loadApp(teamId, appId);
  if (!app) return { app: null, svc: null } as const;
  const svc = (app.services ?? []).find((s) => s.name === serviceName);
  if (!svc) return { app, svc: null } as const;
  return { app, svc } as const;
}

// List env overrides for a single service.
route.get(
  "/teams/:teamId/apps/:appId/services/:name/env",
  requireTeamRole("viewer"),
  async (c) => {
    const { app, svc } = await loadAppAndService(
      c.req.param("teamId"),
      c.req.param("appId"),
      c.req.param("name"),
    );
    if (!app) return c.json({ error: "not found" }, 404);
    if (!svc) return c.json({ error: "service not found" }, 404);
    const vars = await EnvVar.find({
      appId: app._id,
      serviceName: svc.name,
    })
      .sort({ key: 1 })
      .lean();
    return c.json({
      vars: vars.map((v) => view(v as unknown as EnvVarDoc)),
    });
  },
);

// Upsert a service-scoped env override.
route.put(
  "/teams/:teamId/apps/:appId/services/:name/env/:key",
  requireTeamRole("member"),
  zValidator("json", EnvVarInputSchema.pick({ value: true })),
  async (c) => {
    if (!isEncryptionConfigured()) {
      return c.json({ error: "encryption_not_configured" }, 503);
    }
    const { app, svc } = await loadAppAndService(
      c.req.param("teamId"),
      c.req.param("appId"),
      c.req.param("name"),
    );
    if (!app) return c.json({ error: "not found" }, 404);
    if (!svc) return c.json({ error: "service not found" }, 404);
    const key = c.req.param("key");
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return c.json({ error: "invalid_env_key" }, 400);
    }
    const { value } = c.req.valid("json");
    const sealed = seal(value);
    const doc = await EnvVar.findOneAndUpdate(
      { appId: app._id, serviceName: svc.name, key },
      {
        appId: app._id,
        teamId: app.teamId,
        serviceName: svc.name,
        key,
        ciphertext: sealed.ciphertext,
        iv: sealed.iv,
        authTag: sealed.authTag,
      },
      { upsert: true, new: true },
    );
    const user = c.get("user");
    await recordAudit({
      teamId: String(app.teamId),
      userId: user.id,
      userEmail: user.email,
      action: "env.upsert",
      target: {
        type: "env",
        id: String(app._id),
        label: `${app.name}:${svc.name}:${key}`,
      },
      meta: { serviceName: svc.name },
    });
    return c.json(view(doc as unknown as EnvVarDoc));
  },
);

// Delete a service-scoped env override.
route.delete(
  "/teams/:teamId/apps/:appId/services/:name/env/:key",
  requireTeamRole("member"),
  async (c) => {
    const { app, svc } = await loadAppAndService(
      c.req.param("teamId"),
      c.req.param("appId"),
      c.req.param("name"),
    );
    if (!app) return c.json({ error: "not found" }, 404);
    if (!svc) return c.json({ error: "service not found" }, 404);
    const key = c.req.param("key");
    await EnvVar.deleteOne({ appId: app._id, serviceName: svc.name, key });
    const user = c.get("user");
    await recordAudit({
      teamId: String(app.teamId),
      userId: user.id,
      userEmail: user.email,
      action: "env.delete",
      target: {
        type: "env",
        id: String(app._id),
        label: `${app.name}:${svc.name}:${key}`,
      },
      meta: { serviceName: svc.name },
    });
    return c.json({ ok: true });
  },
);
```

- [ ] **Step 2: Update the existing `view()` helper to include `serviceName`**

In the same file, replace the `view()` function (lines 21-28) with:

```ts
function view(e: EnvVarDoc): PublicEnvVar {
  return {
    id: String(e._id),
    key: e.key,
    serviceName: e.serviceName ?? "",
    createdAt: (e as EnvVarDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (e as EnvVarDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/api && bun run typecheck`
Expected: no errors.

- [ ] **Step 4: Smoke-check the route table by starting the API briefly**

Run: `cd apps/api && timeout 3 bun run dev || true`
Expected: server boots, prints `[api] listening on …` with no Hono route errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/env.ts
git commit -m "feat(api): service-scoped env routes"
```

---

## Task 6: `EnvVarsCard` learns about scope

**Files:**
- Modify: `apps/web/src/components/EnvVarsCard.tsx`

- [ ] **Step 1: Add the scope prop and route the URLs through it**

Replace the entire contents of `apps/web/src/components/EnvVarsCard.tsx` with:

```tsx
import { useEffect, useState, type FormEvent } from "react";
import type { PublicEnvVar } from "@pmploy/shared";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { Card, CardDescription, CardTitle } from "./ui/Card";

export type EnvScope =
  | { type: "app" }
  | { type: "service"; serviceName: string };

export function EnvVarsCard({
  teamId,
  appId,
  canManage,
  scope = { type: "app" },
}: {
  teamId: string;
  appId: string;
  canManage: boolean;
  scope?: EnvScope;
}) {
  const [vars, setVars] = useState<PublicEnvVar[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const basePath =
    scope.type === "app"
      ? `/teams/${teamId}/apps/${appId}/env`
      : `/teams/${teamId}/apps/${appId}/services/${encodeURIComponent(
          scope.serviceName,
        )}/env`;

  async function load() {
    setError(null);
    try {
      const [v, s] = await Promise.all([
        api<{ vars: PublicEnvVar[] }>(basePath),
        api<{ configured: boolean }>(`/env/status`),
      ]);
      setVars(v.vars);
      setConfigured(s.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }

  useEffect(() => {
    setVars(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, appId, scope.type, scope.type === "service" ? scope.serviceName : ""]);

  async function onUpsert(e: FormEvent) {
    e.preventDefault();
    if (!key) return;
    setBusy("upsert");
    setError(null);
    try {
      await api(`${basePath}/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: { value },
      });
      setKey("");
      setValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(k: string) {
    if (!confirm(`Delete ${k}?`)) return;
    setBusy(k);
    try {
      await api(`${basePath}/${encodeURIComponent(k)}`, { method: "DELETE" });
      setVars((cur) => (cur ? cur.filter((v) => v.key !== k) : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  const title =
    scope.type === "app"
      ? "Environment variables"
      : "Service environment overrides";
  const description =
    scope.type === "app"
      ? "Values are encrypted at rest with AES-256-GCM and injected into every service on start."
      : "Overrides for this service. These take precedence over the app-level shared variables.";

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardDescription className="mt-1">{description}</CardDescription>
      {configured === false && (
        <p className="mt-3 rounded-md border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-200">
          Set <code>ENV_ENCRYPTION_KEY</code> to a 32-byte base64 value (e.g.
          <code>openssl rand -base64 32</code>) and restart the API before
          adding secrets.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <ul className="mt-4 divide-y divide-neutral-800">
        {vars === null && <li className="py-3 text-neutral-500">Loading…</li>}
        {vars && vars.length === 0 && (
          <li className="py-3 text-neutral-500">
            {scope.type === "app" ? "No variables yet." : "No overrides yet."}
          </li>
        )}
        {vars?.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-3">
            <span className="flex-1 font-mono text-sm">{v.key}</span>
            <span className="font-mono text-xs text-neutral-500">●●●●●●</span>
            {canManage && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy !== null}
                onClick={() => onDelete(v.key)}
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canManage && configured !== false && (
        <form onSubmit={onUpsert} className="mt-6 grid grid-cols-[1fr,2fr,auto] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`env-key-${scope.type}`}>Key</Label>
            <Input
              id={`env-key-${scope.type}`}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`env-val-${scope.type}`}>Value</Label>
            <Input
              id={`env-val-${scope.type}`}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="postgres://…"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy !== null || !key}>
              {busy === "upsert" ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck the web app**

Run: `cd apps/web && bun run typecheck`
Expected: no errors. (If the script is `tsc -b` or similar, follow the same pattern as the rest of the codebase.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/EnvVarsCard.tsx
git commit -m "feat(web): scope EnvVarsCard to app or service"
```

---

## Task 7: ServicesCard (web)

**Files:**
- Create: `apps/web/src/components/ServicesCard.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/src/components/ServicesCard.tsx`:

```tsx
import { Link } from "react-router-dom";
import type { PublicService } from "@pmploy/shared";
import { Card, CardDescription, CardTitle } from "./ui/Card";
import { StatusPill } from "./ui/StatusPill";
import { bytes } from "../lib/format";

function serviceAppStatus(svc: PublicService): "running" | "stopped" | "errored" | "deploying" {
  const s = svc.pm2?.status;
  if (s === "online") return "running";
  if (s === "errored") return "errored";
  if (s === "launching") return "deploying";
  return "stopped";
}

export function ServicesCard({
  appId,
  services,
}: {
  appId: string;
  services: PublicService[];
}) {
  return (
    <Card>
      <CardTitle>Services</CardTitle>
      <CardDescription className="mt-1">
        Each service is a PM2 process declared in <code>ecosystem.config.cjs</code>.
        Click a service to view its logs and environment overrides.
      </CardDescription>

      <ul className="mt-4 divide-y divide-neutral-800">
        {services.length === 0 && (
          <li className="py-3 text-neutral-500">
            No services yet — deploy this app to see them.
          </li>
        )}
        {services.map((svc) => (
          <li key={svc.name}>
            <Link
              to={`/apps/${appId}/services/${encodeURIComponent(svc.name)}`}
              className="flex items-center gap-3 py-3 hover:opacity-80"
            >
              <StatusPill status={serviceAppStatus(svc)} />
              <span className="font-mono text-sm">{svc.name}</span>
              {svc.isPrimary && (
                <span className="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                  primary
                </span>
              )}
              <span className="font-mono text-xs text-neutral-500">
                {svc.port !== null ? `:${svc.port}` : "—"}
              </span>
              <span className="ml-auto flex gap-4 font-mono text-xs text-neutral-500">
                <span>cpu {svc.pm2 ? `${svc.pm2.cpu}%` : "—"}</span>
                <span>mem {svc.pm2 ? bytes(svc.pm2.memory) : "—"}</span>
              </span>
              <span className="text-neutral-500">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ServicesCard.tsx
git commit -m "feat(web): add ServicesCard component"
```

---

## Task 8: Render ServicesCard on AppDetailPage and hide aggregate Process card for multi-service apps

**Files:**
- Modify: `apps/web/src/pages/AppDetailPage.tsx`

- [ ] **Step 1: Import the new component**

In `apps/web/src/pages/AppDetailPage.tsx`, add to the imports near the top (after the `EnvVarsCard` import on line 10):

```tsx
import { ServicesCard } from "../components/ServicesCard";
```

- [ ] **Step 2: Conditionally render the Process card**

Find the `Process` card block in the JSX (starts around line 203 with `<Card><CardTitle>Process</CardTitle>`). Wrap the entire `<Card>…</Card>` for the Process card in a conditional:

Replace:

```tsx
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Process</CardTitle>
```

…through the Process card's closing `</Card>` …with:

```tsx
      <div className={`grid gap-4 ${app.services.length > 1 ? "" : "md:grid-cols-2"}`}>
        {app.services.length <= 1 && (
          <Card>
            <CardTitle>Process</CardTitle>
```

And change that Process card's closing `</Card>` to `</Card>)}` to close the conditional.

(Practical edit: leave the `Configuration` card alone in either branch — it stays in the grid. When `services.length > 1`, the grid collapses to one column showing only Configuration; when `<= 1`, both Process and Configuration render side-by-side.)

- [ ] **Step 3: Insert `<ServicesCard>` after the Metrics card**

In the same file, find the Metrics card (begins `<Card><CardTitle>Metrics</CardTitle>` around line 246). After that `</Card>`, before the `{currentTeamId && (<EnvVarsCard …`, insert:

```tsx
      <ServicesCard appId={app.id} services={app.services} />
```

- [ ] **Step 4: Manual smoke test**

Run the API (`cd apps/api && bun run dev`) and web (`cd apps/web && bun run dev`) in separate terminals. Open the browser to an app. Verify:
- Single-process app: Process card still visible, Services card shows one row `default`.
- Multi-service app: Process card hidden, Services card lists each service with status/port/cpu/mem and a `→` arrow.

If you can't reach a multi-service app locally, paste the app detail URL output and visually verify the single-process case at minimum.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/AppDetailPage.tsx
git commit -m "feat(web): list services on app detail page"
```

---

## Task 9: ServiceLogStream component

**Files:**
- Create: `apps/web/src/components/ServiceLogStream.tsx`

- [ ] **Step 1: Implement the component**

Create `apps/web/src/components/ServiceLogStream.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

type LogEvent = { stream: "stdout" | "stderr"; line: string };

export function ServiceLogStream({
  teamId,
  appId,
  serviceName,
}: {
  teamId: string;
  appId: string;
  serviceName: string;
}) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const url = `/api/teams/${teamId}/apps/${appId}/services/${encodeURIComponent(
      serviceName,
    )}/logs`;
    const es = new EventSource(url, { withCredentials: true });

    const onMessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as LogEvent;
        setEvents((cur) => {
          const next = cur.length > 2000 ? cur.slice(-2000) : cur;
          return [...next, ev];
        });
      } catch {
        // ignore malformed
      }
    };
    es.onopen = () => setConnected(true);
    es.onmessage = onMessage;
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects.
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [teamId, appId, serviceName]);

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span className={connected ? "text-emerald-400" : "text-amber-400"}>
          {connected ? "● live" : "○ reconnecting"}
        </span>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>
      <div
        ref={ref}
        className="max-h-[32rem] overflow-y-auto rounded-md border border-neutral-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-neutral-200"
      >
        {events.length === 0 ? (
          <p className="text-neutral-500">Waiting for logs…</p>
        ) : (
          events.map((ev, i) => (
            <pre
              key={i}
              className={
                ev.stream === "stderr"
                  ? "whitespace-pre-wrap break-all text-red-300"
                  : "whitespace-pre-wrap break-all"
              }
            >
              {ev.line || " "}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ServiceLogStream.tsx
git commit -m "feat(web): ServiceLogStream SSE viewer with stderr coloring"
```

---

## Task 10: ServiceDetailPage

**Files:**
- Create: `apps/web/src/pages/ServiceDetailPage.tsx`

- [ ] **Step 1: Implement the page**

Create `apps/web/src/pages/ServiceDetailPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PublicApplication, PublicEnvVar, PublicService } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import { EnvVarsCard } from "../components/EnvVarsCard";
import { ServiceLogStream } from "../components/ServiceLogStream";
import { bytes, ms } from "../lib/format";

function serviceAppStatus(svc: PublicService): "running" | "stopped" | "errored" | "deploying" {
  const s = svc.pm2?.status;
  if (s === "online") return "running";
  if (s === "errored") return "errored";
  if (s === "launching") return "deploying";
  return "stopped";
}

export default function ServiceDetailPage() {
  const { appId, serviceName } = useParams<{ appId: string; serviceName: string }>();
  const { currentTeamId, teams } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const canManage = team?.role && team.role !== "viewer";

  const [app, setApp] = useState<PublicApplication | null>(null);
  const [sharedVars, setSharedVars] = useState<PublicEnvVar[] | null>(null);
  const [showShared, setShowShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentTeamId || !appId) return;
    try {
      const a = await api<PublicApplication>(`/teams/${currentTeamId}/apps/${appId}`);
      setApp(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, [currentTeamId, appId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!app || !currentTeamId || !appId) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [app, currentTeamId, appId, load]);

  useEffect(() => {
    if (!currentTeamId || !appId || !showShared) return;
    if (sharedVars !== null) return;
    api<{ vars: PublicEnvVar[] }>(`/teams/${currentTeamId}/apps/${appId}/env`)
      .then((r) => setSharedVars(r.vars))
      .catch(() => setSharedVars([]));
  }, [currentTeamId, appId, showShared, sharedVars]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!app) return <p className="text-neutral-500">Loading…</p>;

  const svc = app.services.find((s) => s.name === serviceName);
  if (!svc) {
    return (
      <div className="space-y-3">
        <Link to={`/apps/${app.id}`} className="text-sm text-neutral-400 underline">
          ← back to app
        </Link>
        <p className="text-sm text-amber-300">
          Service <span className="font-mono">{serviceName}</span> no longer exists. The
          ecosystem file may have changed since the last deploy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link to={`/apps/${app.id}`} className="text-sm text-neutral-400 underline">
          ← back to {app.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{svc.name}</h1>
        <StatusPill status={serviceAppStatus(svc)} />
        {svc.isPrimary && (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-neutral-400">
            primary
          </span>
        )}
        <span className="font-mono text-xs text-neutral-500">{svc.pm2Name}</span>
      </header>

      <Card>
        <CardTitle>Process</CardTitle>
        <CardDescription className="mt-1">PM2 runtime snapshot.</CardDescription>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-neutral-500">status</dt>
          <dd className="font-mono">{svc.pm2?.status ?? "not running"}</dd>
          <dt className="text-neutral-500">pid</dt>
          <dd className="font-mono">{svc.pm2?.pid || "—"}</dd>
          <dt className="text-neutral-500">port</dt>
          <dd className="font-mono">{svc.port ?? "—"}</dd>
          <dt className="text-neutral-500">cpu</dt>
          <dd className="font-mono">{svc.pm2 ? `${svc.pm2.cpu}%` : "—"}</dd>
          <dt className="text-neutral-500">memory</dt>
          <dd className="font-mono">{svc.pm2 ? bytes(svc.pm2.memory) : "—"}</dd>
          <dt className="text-neutral-500">uptime</dt>
          <dd className="font-mono">{svc.pm2 ? ms(svc.pm2.uptime) : "—"}</dd>
          <dt className="text-neutral-500">restarts</dt>
          <dd className="font-mono">{svc.pm2?.restarts ?? 0}</dd>
        </dl>
      </Card>

      <Card>
        <CardTitle>Logs</CardTitle>
        <CardDescription className="mt-1">
          Live stdout / stderr from this PM2 process. Reading from{" "}
          <code>~/.pm2/logs/{svc.pm2Name}-*.log</code>.
        </CardDescription>
        <div className="mt-3">
          {currentTeamId && (
            <ServiceLogStream
              teamId={currentTeamId}
              appId={app.id}
              serviceName={svc.name}
            />
          )}
        </div>
      </Card>

      {currentTeamId && (
        <EnvVarsCard
          teamId={currentTeamId}
          appId={app.id}
          canManage={!!canManage}
          scope={{ type: "service", serviceName: svc.name }}
        />
      )}

      <Card>
        <CardTitle>Shared environment</CardTitle>
        <CardDescription className="mt-1">
          App-level variables applied to every service.{" "}
          <Link to={`/apps/${app.id}`} className="text-neutral-400 underline">
            Edit on the app page
          </Link>
          .
        </CardDescription>
        <button
          type="button"
          onClick={() => setShowShared((v) => !v)}
          className="mt-3 text-xs text-neutral-400 underline"
        >
          {showShared ? "Hide" : "Show"} shared keys
        </button>
        {showShared && (
          <ul className="mt-4 divide-y divide-neutral-800">
            {sharedVars === null && (
              <li className="py-3 text-neutral-500">Loading…</li>
            )}
            {sharedVars && sharedVars.length === 0 && (
              <li className="py-3 text-neutral-500">No shared variables.</li>
            )}
            {sharedVars?.map((v) => (
              <li key={v.id} className="py-2 font-mono text-sm">
                {v.key}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/ServiceDetailPage.tsx
git commit -m "feat(web): ServiceDetailPage with logs and per-service env"
```

---

## Task 11: Register the service route

**Files:**
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Add import and route**

In `apps/web/src/App.tsx`, after the `import DeploymentDetailPage…` line, add:

```tsx
import ServiceDetailPage from "./pages/ServiceDetailPage";
```

In the `<Routes>` block, after the existing `apps/:appId/deployments/:deploymentId` route, insert:

```tsx
          <Route
            path="apps/:appId/services/:serviceName"
            element={<ServiceDetailPage />}
          />
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && bun run typecheck`
Expected: no errors.

- [ ] **Step 3: Manual end-to-end smoke**

With API and web running:
1. Open a multi-service app, click a service row → land on the service page.
2. Verify the status pill, PM2 name, process stats render.
3. Watch the Logs card — `● live` indicator, lines stream in.
4. Add an env override, refresh, confirm it persists.
5. Click "Show shared keys" — app-level keys list out.
6. Redeploy the app (if you can) — confirm the override is injected into the service's environment (e.g. by adding a `DUMMY` env override and `console.log(process.env.DUMMY)` in the service code).

For a single-process app, navigate to `/apps/<id>/services/default` and confirm the same UI works.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/App.tsx
git commit -m "feat(web): register service detail route"
```

---

## Task 12: Document the index migration in PRODUCTION.md

**Files:**
- Modify: `docs/PRODUCTION.md`

- [ ] **Step 1: Add an operator note**

Append to `docs/PRODUCTION.md` a new section:

```markdown
## Per-service env vars index migration

The `EnvVar` collection's unique index changed from `{ appId: 1, key: 1 }` to
`{ appId: 1, serviceName: 1, key: 1 }`. Mongoose auto-indexes on app start in
development. In production, drop the old index once after upgrading:

```js
db.envvars.dropIndex("appId_1_key_1")
```

Existing rows are read as `serviceName: ""` (shared / app-level) automatically.
```

- [ ] **Step 2: Commit**

```bash
git add docs/PRODUCTION.md
git commit -m "docs: per-service env unique index migration note"
```

---

## Task 13: Final verification

- [ ] **Step 1: Run the API test suite**

Run: `cd apps/api && bun test`
Expected: all tests pass, including the new `envVars.test.ts`.

- [ ] **Step 2: Typecheck everything**

Run: `cd apps/api && bun run typecheck && cd ../web && bun run typecheck && cd ../../packages/shared && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual UI walkthrough**

Re-do the smoke test from Task 11 Step 3 from a fresh app load. Capture any visual regressions and fix in a follow-up commit if needed.

- [ ] **Step 4: Clean working tree**

Run: `git status`
Expected: clean. If anything is uncommitted from manual fixes, commit it with a clear message.
