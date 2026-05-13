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

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function applicationView(
  app: ApplicationDoc,
  pm2: Pm2Info | null,
): PublicApplication {
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
    status: app.status,
    pm2Name: app.pm2Name,
    pm2,
    createdAt: (app as ApplicationDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (app as ApplicationDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}

async function safeDescribe(name: string): Promise<Pm2Info | null> {
  try {
    return await describeProcess(name);
  } catch {
    return null;
  }
}

// List apps in a team.
route.get("/teams/:teamId/apps", requireTeamRole("viewer"), async (c) => {
  const teamId = c.req.param("teamId");
  const apps = await Application.find({ teamId: new Types.ObjectId(teamId) }).lean();
  // Best-effort PM2 status enrichment in parallel.
  const enriched = await Promise.all(
    apps.map(async (a) => applicationView(a as ApplicationDoc, await safeDescribe(a.pm2Name))),
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

    return c.json(applicationView(app, null), 201);
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
  const pm2 = await safeDescribe(app.pm2Name);
  return c.json(applicationView(app, pm2));
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
    const pm2 = await safeDescribe(app.pm2Name);
    return c.json(applicationView(app, pm2));
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
    await deleteProcess(app.pm2Name).catch(() => undefined);
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
    try {
      app.status = "deploying";
      await app.save();
      const userEnv = await getDecryptedEnv(String(app._id));
      const info = await startProcess({
        name: app.pm2Name,
        cwd: app.cwd,
        script: app.script,
        interpreter: app.interpreter || undefined,
        instances: app.instances ?? 1,
        execMode: app.execMode,
        env: { ...userEnv, PORT: String(app.port ?? "") },
      });
      app.status = info.status === "online" ? "running" : "errored";
      await app.save();
      return c.json(applicationView(app, info));
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
      await stopProcess(app.pm2Name);
      app.status = "stopped";
      await app.save();
      const info = await safeDescribe(app.pm2Name);
      return c.json(applicationView(app, info));
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
      await restartProcess(app.pm2Name);
      const info = await safeDescribe(app.pm2Name);
      app.status = info?.status === "online" ? "running" : "errored";
      await app.save();
      return c.json(applicationView(app, info));
    } catch (err) {
      return c.json(
        { error: "pm2_restart_failed", message: (err as Error).message },
        500,
      );
    }
  },
);

export default route;
