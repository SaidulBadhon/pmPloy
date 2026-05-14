import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  CreateApplicationInputSchema,
  UpdateApplicationInputSchema,
  type PublicApplication,
} from "@pmploy/shared";
import { Application, type ApplicationDoc } from "../models/Application.ts";
import { Domain } from "../models/Domain.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import { slugify, randomSuffix } from "../lib/slug.ts";
import { allocatePort } from "../services/ports.ts";
import {
  pm2NameForApp,
  describeProcess,
  startProcess,
  stopProcess,
  restartProcess,
  deleteProcess,
  type Pm2Info,
} from "../services/pm2.ts";
import { caddy } from "../services/caddy.ts";
import { getDecryptedEnv } from "../services/envVars.ts";
import { recordAudit } from "../services/audit.ts";
import { tailProcessLogs, pm2LogPaths } from "../services/processLogs.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

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

// List apps in a team.
route.get("/teams/:teamId/apps", requireTeamRole("viewer"), async (c) => {
  const teamId = c.req.param("teamId");
  const apps = await Application.find({ teamId: new Types.ObjectId(teamId) }).lean();
  // Best-effort PM2 status enrichment in parallel.
  const enriched = await Promise.all(
    apps.map((a) => applicationView(a as ApplicationDoc)),
  );
  return c.json({ apps: enriched });
});

// Create an app.
route.post(
  "/teams/:teamId/apps",
  requireTeamRole("member"),
  zValidator("json", CreateApplicationInputSchema),
  async (c) => {
    const teamId = c.req.param("teamId");
    const input = c.req.valid("json");

    let slug = slugify(input.name) || "app";
    while (
      await Application.findOne({
        teamId: new Types.ObjectId(teamId),
        slug,
      }).lean()
    ) {
      slug = `${slugify(input.name) || "app"}-${randomSuffix()}`;
    }

    const _id = new Types.ObjectId();
    const port = await allocatePort();
    const app = await Application.create({
      _id,
      teamId,
      name: input.name,
      slug,
      sourceType: input.sourceType,
      cwd: input.sourceType === "local" ? input.cwd : "",
      script: input.script,
      interpreter: input.interpreter || "",
      instances: input.instances,
      execMode: input.execMode,
      github: input.sourceType === "github" ? input.github : undefined,
      port,
      status: "created",
      pm2Name: pm2NameForApp(String(_id)),
    });

    const user = c.get("user");
    await recordAudit({
      teamId,
      userId: user.id,
      userEmail: user.email,
      action: "app.create",
      target: { type: "app", id: String(app._id), label: app.name },
      meta: { sourceType: app.sourceType },
    });

    return c.json(await applicationView(app), 201);
  },
);

async function loadAppForTeam(teamId: string, appId: string) {
  if (!Types.ObjectId.isValid(appId)) return null;
  const app = await Application.findOne({
    _id: new Types.ObjectId(appId),
    teamId: new Types.ObjectId(teamId),
  });
  return app;
}

// Read one.
route.get("/teams/:teamId/apps/:appId", requireTeamRole("viewer"), async (c) => {
  const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
  if (!app) return c.json({ error: "not found" }, 404);
  return c.json(await applicationView(app));
});

// Update.
route.patch(
  "/teams/:teamId/apps/:appId",
  requireTeamRole("member"),
  zValidator("json", UpdateApplicationInputSchema),
  async (c) => {
    const app = await loadAppForTeam(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const patch = c.req.valid("json");
    if (patch.name !== undefined) app.name = patch.name;
    if (patch.cwd !== undefined) app.cwd = patch.cwd;
    if (patch.script !== undefined) app.script = patch.script;
    if (patch.interpreter !== undefined) app.interpreter = patch.interpreter;
    if (patch.instances !== undefined) app.instances = patch.instances;
    if (patch.execMode !== undefined) app.execMode = patch.execMode;
    if (patch.github !== undefined && app.sourceType === "github" && app.github) {
      Object.assign(app.github, patch.github);
    }
    await app.save();
    return c.json(await applicationView(app));
  },
);

// Delete (also tears down the PM2 process and Caddy routes).
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

// --- Process actions ---

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
    // Multi-service apps own per-service config in ecosystem.config.cjs;
    // pmPloy only has app.script/interpreter/etc for the synthetic "default"
    // service, so re-starting named services here would corrupt their config.
    // Redeploying is the safe path.
    const isMultiService =
      services.length > 1 || (services[0] && services[0].name !== "default");
    if (isMultiService) {
      return c.json(
        {
          error: "multi_service_app",
          message: "this app has multiple services; redeploy to (re)start them",
        },
        409,
      );
    }
    try {
      app.status = "deploying";
      await app.save();
      const userEnv = await getDecryptedEnv(String(app._id));
      const svc = services[0]!;
      await startProcess({
        name: svc.pm2Name,
        cwd: app.cwd,
        script: app.script,
        interpreter: app.interpreter || undefined,
        instances: app.instances ?? 1,
        execMode: app.execMode,
        env: { ...userEnv, PORT: String(svc.port ?? "") },
      });
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

export default route;
