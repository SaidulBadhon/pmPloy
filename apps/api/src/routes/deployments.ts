import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  TriggerDeployInputSchema,
  type PublicDeployment,
  type PublicDeploymentWithLogs,
} from "@pmploy/shared";
import { Application } from "../models/Application.ts";
import { Deployment, type DeploymentDoc } from "../models/Deployment.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import { deleteDeploymentForApp, enqueueDeploy } from "../services/deploy.ts";
import { recordAudit } from "../services/audit.ts";
import { deployBus, deployTopic } from "../services/pubsub.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function view(d: DeploymentDoc): PublicDeployment {
  return {
    id: String(d._id),
    appId: String(d.appId),
    teamId: String(d.teamId),
    status: d.status,
    triggeredBy: d.triggeredBy,
    commitSha: d.commitSha ?? "",
    commitMessage: d.commitMessage ?? "",
    branch: d.branch ?? "",
    errorMessage: d.errorMessage ?? "",
    workdir: d.workdir ?? "",
    startedAt: d.startedAt ? d.startedAt.toISOString() : null,
    finishedAt: d.finishedAt ? d.finishedAt.toISOString() : null,
    createdAt: (d as DeploymentDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (d as DeploymentDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}

async function loadApp(teamId: string, appId: string) {
  if (!Types.ObjectId.isValid(appId) || !Types.ObjectId.isValid(teamId)) return null;
  return Application.findOne({
    _id: new Types.ObjectId(appId),
    teamId: new Types.ObjectId(teamId),
  });
}

// List recent deployments for an app.
route.get(
  "/teams/:teamId/apps/:appId/deployments",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const deployments = await Deployment.find({ appId: app._id })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    return c.json({
      deployments: deployments.map((d) => view(d as unknown as DeploymentDoc)),
    });
  },
);

// Trigger a manual deploy.
route.post(
  "/teams/:teamId/apps/:appId/deploy",
  requireTeamRole("member"),
  zValidator("json", TriggerDeployInputSchema),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const user = c.get("user");
    const input = c.req.valid("json");
    try {
      const dep = await enqueueDeploy({
        appId: String(app._id),
        triggeredBy: "user",
        triggeredByUserId: user.id,
        branch: input.branch,
        commitSha: input.commitSha,
      });
      return c.json(view(dep), 202);
    } catch (err) {
      return c.json(
        { error: "enqueue_failed", message: (err as Error).message },
        500,
      );
    }
  },
);

// Delete deployment metadata and GitHub checkout dir (when applicable).
route.delete(
  "/teams/:teamId/apps/:appId/deployments/:deploymentId",
  requireTeamRole("admin"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const appId = c.req.param("appId");
    const deploymentId = c.req.param("deploymentId");
    const result = await deleteDeploymentForApp(teamId, appId, deploymentId);
    if (!result.ok) {
      const body = { error: result.error, message: result.message };
      if (result.status === 404) return c.json(body, 404);
      if (result.status === 409) return c.json(body, 409);
      return c.json(body, 500);
    }
    const user = c.get("user");
    await recordAudit({
      teamId,
      userId: user.id,
      userEmail: user.email,
      action: "deployment.delete",
      target: { type: "app", id: appId },
      meta: { deploymentId },
    });
    return c.json({ ok: true });
  },
);

// Get a single deployment with its logs.
route.get(
  "/teams/:teamId/apps/:appId/deployments/:deploymentId",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const id = c.req.param("deploymentId");
    if (!Types.ObjectId.isValid(id)) return c.json({ error: "not found" }, 404);
    const d = await Deployment.findOne({
      _id: new Types.ObjectId(id),
      appId: app._id,
    }).lean();
    if (!d) return c.json({ error: "not found" }, 404);
    const base = view(d as unknown as DeploymentDoc);
    return c.json({ ...base, logs: d.logs ?? [] } satisfies PublicDeploymentWithLogs);
  },
);

// Live log stream via SSE.
route.get(
  "/teams/:teamId/apps/:appId/deployments/:deploymentId/stream",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const id = c.req.param("deploymentId");
    if (!Types.ObjectId.isValid(id)) return c.json({ error: "not found" }, 404);
    const dep = await Deployment.findOne({
      _id: new Types.ObjectId(id),
      appId: app._id,
    }).lean();
    if (!dep) return c.json({ error: "not found" }, 404);

    const topic = deployTopic(id);

    return streamSSE(c, async (stream) => {
      // Replay existing logs first so late joiners see context.
      for (const line of dep.logs ?? []) {
        await stream.writeSSE({ event: "log", data: line });
      }
      await stream.writeSSE({ event: "status", data: dep.status });
      if (dep.status === "live" || dep.status === "failed" || dep.status === "cancelled") {
        await stream.writeSSE({ event: "done", data: "" });
        return;
      }

      let closed = false;
      const unsubscribe = deployBus.subscribe(topic, (ev) => {
        if (closed) return;
        if (ev.type === "log") {
          stream.writeSSE({ event: "log", data: ev.line }).catch(() => undefined);
        } else if (ev.type === "status") {
          stream
            .writeSSE({ event: "status", data: ev.status })
            .catch(() => undefined);
        } else if (ev.type === "done") {
          stream.writeSSE({ event: "done", data: "" }).catch(() => undefined);
        }
      });

      stream.onAbort(() => {
        closed = true;
        unsubscribe();
      });

      // Heartbeat so proxies don't kill an idle stream.
      while (!closed) {
        await stream.sleep(15_000);
        if (closed) break;
        await stream.writeSSE({ event: "ping", data: "" });
      }
    });
  },
);

export default route;
