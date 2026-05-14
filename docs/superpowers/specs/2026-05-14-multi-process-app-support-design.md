# Multi-Process App Support — Design

## Problem

pmPloy assumes one Application = one PM2 process. The data model carries a single `script`/`port`/`pm2Name` per app, and the deploy pipeline starts exactly one PM2 process named `pmploy:<appId>` ([deploy.ts:241](../../../apps/api/src/services/deploy.ts:241)).

Real projects routinely run multiple processes — a frontend bundle server, a backend API, a worker — declared together in an `ecosystem.config.cjs`. When a user wires that up today, the build command (`bun run pm2:start` or similar) starts the declared processes under *their own names* (`agentchat-app`, `agentchat-backend`, `agentchat-website`). pmPloy's later lookup for `pmploy:<appId>` returns nothing, so:

- Status is reported as "online" based on a process pmPloy itself spawned alongside the ecosystem (a spurious extra), but `describeProcess` returns null for the ones the user actually cares about.
- Restart/stop/delete operate on a process that isn't really doing the work.
- App deletion leaves orphaned PM2 processes behind.
- There is no runtime log surface — the deploy log captures the build, but nothing surfaces stdout/stderr from the running processes.
- Caddy domain routing can only target one port; multi-service apps where the public surface is e.g. only the `-website` process can't route different domains to different services.

## Goals

1. A single pmPloy Application can own multiple PM2 processes declared in `ecosystem.config.{cjs,js,json}`.
2. Detection is automatic — no UI toggle. If the build directory contains an ecosystem file, the app is multi-process.
3. Each service is independently routable: a Domain can point at a specific service, falling back to a designated primary.
4. Port defaults come from the ecosystem file; users can override them in pmPloy without editing the file.
5. Status, restart, stop, delete, and log surfaces operate on the full service set with no orphans.
6. Single-process apps keep working unchanged — backwards compatibility is non-negotiable.

## Non-goals

- Supporting ecosystem features beyond apps (PM2 deploy blocks, namespaces, instance scaling per service).
- Multi-server orchestration. pmPloy remains single-host.
- Editing the ecosystem file from the pmPloy UI — pmPloy reads it, never writes it.
- Auto-restart on file changes.

## Data model

### Application (additive changes)

```ts
// apps/api/src/models/Application.ts
const serviceSchema = new Schema(
  {
    name: { type: String, required: true },        // from ecosystem.config.cjs
    pm2Name: { type: String, required: true },     // "pmploy:<appId>:<name>"
    port: { type: Number, default: null },         // null = no public port
    isPrimary: { type: Boolean, default: false },  // default routing target
  },
  { _id: false },
);

// added to applicationSchema:
services: { type: [serviceSchema], default: [] }
```

Existing fields (`script`, `instances`, `execMode`, `port`, `pm2Name`) remain. They represent the *single-process default* when `services` is empty.

### Domain (one new field)

```ts
// added to domainSchema:
serviceName: { type: String, default: "" }   // "" = route to primary
```

### Migration

No destructive migration. Existing apps have `services: []` and continue to operate against the single-process fields. On the first deploy after the upgrade, if an ecosystem file is detected, `services` gets populated.

## PM2 naming

Every PM2 process pmPloy owns is named `pmploy:<appId>:<serviceName>`. For backwards-compatible single-process apps, the synthetic service name is `default`, giving `pmploy:<appId>:default`. (The existing `pm2Name` field — currently `pmploy:<appId>` — is migrated to this on first deploy after the upgrade; the migration is "delete the old process, start the new one under the new name" inside the existing redeploy flow.)

The prefix prevents collisions: two pmPloy apps that both declare a `web` service get `pmploy:<appIdA>:web` and `pmploy:<appIdB>:web`. Users running `pm2 list` outside pmPloy see prefixed names — documented in PRODUCTION.md.

## Deploy flow

After clone + `bun install` succeed, before the existing `startApp` call:

1. **Detect ecosystem file** in `buildDir`: try `ecosystem.config.cjs`, `.js`, `.json` in that order. If none, skip to step 5 (legacy single-process path).

2. **Parse the ecosystem file.** For `.cjs`/`.js`, evaluate with bun in a clean subprocess so that any side-effecting requires happen in an isolated context:

   ```ts
   const out = await runCapture(
     ["bun", "-e", `console.log(JSON.stringify(require('./ecosystem.config.cjs')))`],
     { cwd: buildDir, timeoutMs: 10_000 },
   );
   const apps = JSON.parse(out).apps as EcosystemApp[];
   ```

   For `.json`, just `JSON.parse(readFile(...))`. If parsing fails, log the error, abort the deploy with a clear message.

3. **Reconcile services.** Diff parsed apps against the existing `application.services`:
   - **New service** (name in ecosystem, not in services array): append with `port = parseInt(env.PORT)` if present, else `null`. `isPrimary = false` unless it's the only service.
   - **Existing service** (name in both): keep the user's `port` override and `isPrimary` choice. Update internal config (script, cwd, env, interpreter) from the ecosystem file.
   - **Removed service** (in services array, not in ecosystem): mark for teardown.
   - If no service has `isPrimary = true` after reconciliation, set the first one as primary.

4. **Start/replace each service.** For each ecosystem app, call `startProcess({ name: service.pm2Name, script, cwd, interpreter, instances, execMode, env: { ...userEnv, ...ecosystemEnv, PORT: service.port } })`. PM2 replaces existing processes by name, so this idempotently rolls each service forward. Note: `pmPloy` does **not** invoke `pm2 start ecosystem.config.cjs`; it orchestrates each process directly. This keeps every running process under a pmPloy-controlled name.

5. **Legacy single-process path:** starts one process named `pmploy:<appId>:default` from `app.script`. The synthetic service `{ name: "default", pm2Name: "pmploy:<appId>:default", port: app.port, isPrimary: true }` is materialized in-memory (not persisted) so the rest of the system can treat single- and multi-process apps uniformly. **All** processes pmPloy owns — single- or multi-process — use the `pmploy:<appId>:<serviceName>` naming convention. The first deploy after this upgrade tears down any pre-existing `pmploy:<appId>` process (the old single-process name) before starting the new `pmploy:<appId>:default`. `pm2NameForApp(appId)` is updated to return `pmploy:<appId>:default` for legacy callers; new code paths use the per-service `pm2Name`.

6. **Teardown removed services.** After the new processes are healthy, `deleteProcess(service.pm2Name)` for each service marked in step 3.

7. **Save the updated `services` array** on the Application.

## Routing

`resyncDomains` in [deploy.ts:275](../../../apps/api/src/services/deploy.ts:275) changes to:

```ts
for (const d of domains) {
  const targetService = d.serviceName
    ? services.find((s) => s.name === d.serviceName)
    : services.find((s) => s.isPrimary);
  if (!targetService?.port) {
    d.sslStatus = "error";
    d.lastError = `no port for service ${d.serviceName || "(primary)"}`;
    continue;
  }
  await caddy.upsertDomain(d.host, targetService.port);
  ...
}
```

A Domain with `serviceName = ""` always routes to the primary. Setting `serviceName` to a specific service pins it.

## Status aggregation

```ts
function appStatus(services: ServiceStatus[]): AppStatus {
  if (services.length === 0) return "stopped";
  if (services.every((s) => s.status === "online")) return "running";
  if (services.some((s) => s.status === "errored")) return "errored";
  return "degraded";
}
```

The `Application.status` field gets the aggregate. The UI lists per-service statuses in a table.

## Runtime logs

New module `apps/api/src/services/processLogs.ts`:

```ts
export async function* tailProcessLogs(
  pm2Name: string,
  opts: { from?: "head" | "tail", limit?: number, signal?: AbortSignal }
): AsyncIterable<{ stream: "stdout" | "stderr", line: string }>;
```

Reads `~/.pm2/logs/<pm2Name>-out.log` and `<pm2Name>-error.log`. On first connect, emits the last N lines (default 200) from both files; then watches both via `fs.watch` and emits new lines as they arrive. The abort signal stops the watch.

New route: `GET /apps/:id/services/:name/logs?stream=sse`. Streams `{stream, line}` events via Server-Sent Events. The client UI panel subscribes and renders a tail per service.

For backwards compatibility, `GET /apps/:id/logs` (no service) maps to the primary service.

## UI changes

These are described for completeness but are a separate implementation phase after the API:

- **App detail page:** A "Services" panel under the existing app info. One row per service: name, status badge, port (with inline edit), CPU/memory, "Logs" button, "Primary" radio (one and only one across services). For single-process apps the panel shows one row labelled "default" — visually unobtrusive.
- **Service logs panel:** Modal or side-drawer that opens the SSE stream. stdout and stderr interleaved, color-coded.
- **Domains form:** When adding/editing a domain, a dropdown next to the host field: "Route to:" with options "Primary (current: <name>)" and each service by name.

## Error handling and edge cases

- **Ecosystem file present but `apps` is empty or missing:** treat as parse error; abort deploy with `ecosystem file declares no apps`.
- **Ecosystem file evaluates with side effects:** the subprocess timeout (10s) bounds it. If it hangs or errors, deploy aborts.
- **Service name collision within a single ecosystem file:** abort deploy with `duplicate service name "<name>"`.
- **Service name contains invalid PM2 chars (whitespace, colon):** abort deploy. Documented in PRODUCTION.md.
- **User deletes the ecosystem file in a later commit:** the deploy reconciliation detects all services as "removed", tears them all down. The app falls back to single-process mode using the existing `app.script` field. If `app.script` is empty (the user never set it), the deploy fails with a clear message: `ecosystem.config.cjs removed and no fallback script configured`.
- **Two services declare the same port in the ecosystem file:** pmPloy stores them as-is. PM2/the OS will fail one of them at runtime; that surfaces as `errored` status, which the user sees in the services panel.
- **Domain points at a service that was removed:** routing fails over to the primary, and the Domain's `lastError` records `service <name> no longer exists; falling back to primary`.
- **Process orphans from before this feature lands:** the first deploy after upgrade should tear down any process matching `pmploy:<appId>` (the old single-process name) before starting the new `pmploy:<appId>:default`. Implemented as `deleteProcess(`pmploy:${appId}`).catch(() => undefined)` at the start of the migration path.

## Testing

- Unit tests for ecosystem parsing: valid .cjs, valid .json, missing `apps`, duplicate names, invalid chars, timeout.
- Unit tests for service reconciliation: new/existing/removed combinations preserve port overrides and primary choice.
- Integration test for deploy flow with a fixture ecosystem.config.cjs declaring two services; assert two PM2 processes exist with the expected prefixed names, app status is `running`, and removing the file on next deploy tears them down.
- Integration test for routing: a Domain with `serviceName = "api"` points Caddy at the api service's port.
- Backwards compatibility: existing single-process apps deploy without code changes; assert services array stays empty or migrates correctly.

## Open questions

- Should the per-service `port` accept "0" or "null" to mean "this service has no public surface" (e.g., a worker)? Current design says yes (`port: null`). Domain pointing at a portless service errors at routing time.
- Logs: do we expose `pm2 log rotate` controls in pmPloy, or assume the operator has logrotate configured? Current design: assume external rotation; pmPloy only reads.
- Per-service env overrides in the pmPloy UI: out of scope for v1. The user edits the ecosystem file in git.
