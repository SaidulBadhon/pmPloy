# Per-Service Logs and Env — Design

## Problem

The multi-process-app feature gave pmPloy a `services[]` array on every Application
([Application.ts:14](../../../apps/api/src/models/Application.ts:14)) and a per-service
SSE log endpoint
([apps.ts:339](../../../apps/api/src/routes/apps.ts:339)), but the web UI never
exposes them. [AppDetailPage.tsx](../../../apps/web/src/pages/AppDetailPage.tsx)
shows a single aggregate "Process" card sourced from the primary service only —
the user cannot see which services exist, cannot view their individual runtime
logs, and cannot scope env vars to a single service.

Env vars are currently per-app: every variable is merged into every service's
environment on deploy ([deploy.ts:258-267](../../../apps/api/src/services/deploy.ts:258)).
A multi-service app where (say) only the `api` service needs `DATABASE_URL` has
no way to limit the variable to that service.

## Goals

1. From the app detail page, the user can see every service declared in the
   running `ecosystem.config.cjs` with status, port, CPU, memory.
2. Clicking a service navigates to a dedicated page showing its runtime logs
   (live), process stats, and an env-var editor scoped to that service.
3. Env vars are layerable: app-level "shared" vars apply to every service;
   per-service overrides win when the same key is set in both.
4. The existing app-level env editor keeps working unchanged.
5. Single-process apps (the synthetic `default` service) work uniformly — same
   service page, same env layering — without UI clutter.

## Non-goals

- Editing port / isPrimary / instances / interpreter from the service page.
  The ecosystem file is the source of truth.
- Per-service start/stop/restart controls. The existing app-level controls
  iterate all services; per-service control is a separate feature.
- Surfacing the parsed ecosystem-file contents (script, cwd, env block) in the
  UI.
- A `--tail`/`--lines` selector on the log viewer; the existing 200-line tail
  is fine for v1.

## Backend changes

### EnvVar model — add `serviceName`

[apps/api/src/models/EnvVar.ts](../../../apps/api/src/models/EnvVar.ts):

```ts
const envVarSchema = new Schema(
  {
    teamId: { type: Schema.Types.ObjectId, ref: "Team", required: true, index: true },
    appId:  { type: Schema.Types.ObjectId, ref: "Application", required: true, index: true },
    serviceName: { type: String, default: "" },   // "" = app-level shared
    key: { type: String, required: true, trim: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { timestamps: true },
);

envVarSchema.index({ appId: 1, serviceName: 1, key: 1 }, { unique: true });
```

The previous unique index `{ appId: 1, key: 1 }` is replaced by
`{ appId: 1, serviceName: 1, key: 1 }`. Mongoose's default fills `serviceName`
on read for old rows, so they are interpreted as app-level shared automatically.
The old index must be dropped at startup — handled by Mongoose's auto-index in
development; production operators must run `db.envvars.dropIndex("appId_1_key_1")`
once. Documented in PRODUCTION.md.

### Env-var routes — additive

Existing routes ([env.ts](../../../apps/api/src/routes/env.ts)) keep their
shapes and semantics — they always operate on app-level (`serviceName: ""`)
rows. Three new routes are added:

```
GET    /teams/:teamId/apps/:appId/services/:name/env
PUT    /teams/:teamId/apps/:appId/services/:name/env/:key
DELETE /teams/:teamId/apps/:appId/services/:name/env/:key
```

`GET` returns only the override rows for that service (no fall-through — the UI
shows shared and override panels separately so the user can see exactly what is
overriding what).

`PUT` validates that `:name` exists in `app.services[]`; 404 if not. Same
encryption flow, same audit-log action keys with `:service` appended to the
target label so the audit trail distinguishes scope.

### Deploy: env merging per service

[envVars.ts:10](../../../apps/api/src/services/envVars.ts:10) signature changes:

```ts
export async function getDecryptedEnv(
  appId: string,
  serviceName: string,
): Promise<Record<string, string>>;
```

Implementation queries both `{ appId, serviceName: "" }` and
`{ appId, serviceName }`, decrypts each, and returns the merge with service
overrides last (so they win on key collision).

[deploy.ts:258-267](../../../apps/api/src/services/deploy.ts:258) calls it inside
the service loop, passing `svc.name`. Final precedence per service stays:

```
ecosystem.env  >  service overrides  >  app shared  >  PORT (last)
```

Single-process fallback ([deploy.ts:307](../../../apps/api/src/services/deploy.ts:307))
calls `getDecryptedEnv(appId, "default")` so the synthetic default service can
have its own overrides if a user ever sets them.

### Per-service log endpoint — already exists

`GET /teams/:teamId/apps/:appId/services/:serviceName/logs` is already
implemented at [apps.ts:339](../../../apps/api/src/routes/apps.ts:339). No
backend work needed beyond confirming SSE behavior across reconnects.

## Frontend changes

### Routing

[App.tsx](../../../apps/web/src/App.tsx) gets one new route:

```tsx
<Route
  path="apps/:appId/services/:serviceName"
  element={<ServiceDetailPage />}
/>
```

### AppDetailPage — Services card

New `<ServicesCard services={app.services} appId={app.id} />` rendered between
the Metrics card and the EnvVarsCard. One row per service:

```
┌──────────────────────────────────────────────────────────┐
│ Services                                                 │
├──────────────────────────────────────────────────────────┤
│  ● api        primary  :3001   cpu 4%   mem 102 MB   →   │
│  ● website             :3000   cpu 1%   mem  78 MB   →   │
│  ● worker              —       cpu 0%   mem  42 MB   →   │
└──────────────────────────────────────────────────────────┘
```

Each row is a `<Link to={`/apps/${appId}/services/${name}`}>`. The status dot
uses the existing `StatusPill` colors mapped from `service.pm2?.status`.
"primary" badge shown only when `isPrimary === true`. Port is `—` when null
(e.g. workers).

The existing aggregate "Process" card is **hidden when `services.length > 1`**
to avoid duplicate information. Single-service apps still see it as before.
The "Configuration" card stays in both cases — it describes app-level config
(cwd, sourceType, github) that has no service equivalent.

### ServiceDetailPage

New file `apps/web/src/pages/ServiceDetailPage.tsx`. Loads the app via the
existing `GET /teams/:teamId/apps/:appId`, then finds the service by name from
`app.services[]`. If not found → "service no longer exists; the ecosystem file
may have changed" with a back link.

Layout:

- **Header**: `← back to app` link, service name, `<StatusPill>`, "primary"
  badge if applicable, `pm2Name` (monospace).
- **Process card**: pid, status, cpu, memory, uptime, restarts — same fields as
  the existing app-level Process card, sourced from `service.pm2`. Polls the
  app endpoint every 3 s like the app page does.
- **Logs card**: live SSE stream from
  `GET /teams/:teamId/apps/:appId/services/:serviceName/logs`. Uses
  `<EventSource>` like [DeploymentDetailPage.tsx:43](../../../apps/web/src/pages/DeploymentDetailPage.tsx:43).
  Reuses `<LogViewer>` with stdout/stderr rendered inline (stderr lines in red).
  Has a "Pause auto-scroll" toggle that flips the existing `autoScroll` prop.
- **Service env card**: `<EnvVarsCard scope={{ type: "service", serviceName }} />` —
  override rows only.
- **Shared env card** (read-only, collapsible, default-collapsed): lists the
  app-level keys (just keys, no values) with a note "These apply to all services.
  Edit on the app page." and a `<Link>` back. Helps the user see what is
  already set without bouncing.

### EnvVarsCard scope prop

[EnvVarsCard.tsx](../../../apps/web/src/components/EnvVarsCard.tsx) gains:

```ts
type EnvScope = { type: "app" } | { type: "service"; serviceName: string };

export function EnvVarsCard({
  teamId, appId, canManage, scope = { type: "app" },
}: { teamId: string; appId: string; canManage: boolean; scope?: EnvScope });
```

The card builds its URLs based on `scope`:

- `app`     → `/teams/:teamId/apps/:appId/env[/:key]`
- `service` → `/teams/:teamId/apps/:appId/services/:name/env[/:key]`

Card title becomes "Environment variables" (app scope, unchanged) or
"Service environment overrides" (service scope). All other behavior is shared.

### Shared types

[packages/shared/src/schemas.ts](../../../packages/shared/src/schemas.ts) adds:

```ts
export const PublicEnvVarSchema = z.object({
  id: z.string(),
  key: z.string(),
  serviceName: z.string(),   // "" for app-level shared
  updatedAt: z.string(),
  createdAt: z.string(),
});
```

Existing clients ignore the new field; the server always sets it.

## Error handling and edge cases

- **Service name in URL contains characters outside `[A-Za-z0-9_-]`:**
  `reconcileServices` rejects such names at deploy time, so the URL can only
  point at validated names. URL-encoding handles edge cases.
- **Service removed in a later deploy:** the page renders "service not found"
  with a back link. Any envvars rows with that `serviceName` are left in the
  database; they are not applied at deploy (because no service has that name)
  but become live again if the service reappears with the same name. Documented
  as intentional.
- **App has zero services (never deployed):** the Services card renders empty
  state "No services yet — deploy this app to see them." The existing
  start/restart/stop buttons stay disabled by the existing `app.cwd` check.
- **PM2 log files don't exist yet** (process never started): `tailProcessLogs`
  emits nothing until the watcher sees the first write. UI shows
  "Waiting for logs…" until the first event.
- **SSE stream reconnect:** `EventSource` auto-reconnects; the server emits a
  fresh 200-line tail on reconnect, which may duplicate a few recent lines.
  Acceptable for v1.
- **User adds a service-override for a key that does not exist as shared:**
  Allowed. App-level page does not show it. Service page does. Documented.
- **Deleting an app with per-service env rows:** today the app-delete route
  ([apps.ts:205](../../../apps/api/src/routes/apps.ts:205)) does not remove
  `EnvVar` rows at all — app-level vars are orphaned in the DB on delete. That
  is a pre-existing issue. Per-service rows inherit the same behavior. Fixing
  the cascade is out of scope for this change; flagged for a follow-up.

## Testing

- Unit: `getDecryptedEnv` merge order — service overrides win, shared falls
  through when no override, returns empty when neither exists.
- Unit: env route validates service exists.
- Integration: PUT a service override, deploy, assert the running service has
  the override; assert other services still see the shared value.
- Integration: SSE log endpoint streams existing tail then new lines, closes
  cleanly on client disconnect.
- UI smoke (manual): two-service app shows both rows; clicking opens the
  service page; logs stream live; env override saves and persists across
  reloads.

## Open questions

- Should service-scoped overrides be displayed as a *third* card on the
  app-level page (read-only, grouped by service) so admins can audit overrides
  without clicking into each service? Current design: no — keep the app page
  focused on shared. Revisit if users ask.
- Audit log format: do we add a distinct `env.service.upsert` action key, or
  reuse `env.upsert` and put `serviceName` in `meta`? Current design: reuse
  with `serviceName` in `meta` and append it to the target label for
  readability.
