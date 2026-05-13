import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  AttachDomainInputSchema,
  type PublicDomain,
} from "@pmploy/shared";
import { Application } from "../models/Application.ts";
import { Domain, type DomainDoc } from "../models/Domain.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import { caddy } from "../services/caddy.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function view(d: DomainDoc): PublicDomain {
  return {
    id: String(d._id),
    appId: String(d.appId),
    teamId: String(d.teamId),
    host: d.host,
    sslStatus: d.sslStatus,
    lastError: d.lastError ?? "",
    createdAt: (d as DomainDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (d as DomainDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}

async function loadApp(teamId: string, appId: string) {
  if (!Types.ObjectId.isValid(teamId) || !Types.ObjectId.isValid(appId)) return null;
  return Application.findOne({
    _id: new Types.ObjectId(appId),
    teamId: new Types.ObjectId(teamId),
  });
}

// Caddy reachability probe so the UI can show a setup hint.
route.get("/caddy/status", requireAuth, async (c) => {
  return c.json({ reachable: await caddy.ping() });
});

// List domains for an app.
route.get(
  "/teams/:teamId/apps/:appId/domains",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const domains = await Domain.find({ appId: app._id }).sort({ createdAt: -1 }).lean();
    return c.json({
      domains: domains.map((d) => view(d as unknown as DomainDoc)),
    });
  },
);

// Attach a domain (calls Caddy after persisting).
route.post(
  "/teams/:teamId/apps/:appId/domains",
  requireTeamRole("member"),
  zValidator("json", AttachDomainInputSchema),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    if (!app.port) {
      return c.json(
        { error: "app_has_no_port", message: "deploy the app before attaching a domain" },
        409,
      );
    }
    const { host } = c.req.valid("json");

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
    });

    try {
      await caddy.upsertDomain(host, app.port);
      dom.sslStatus = "active";
      dom.lastError = "";
      await dom.save();
    } catch (err) {
      dom.sslStatus = "error";
      dom.lastError = err instanceof Error ? err.message : String(err);
      await dom.save();
    }
    return c.json(view(dom), 201);
  },
);

// Retry pushing a domain to Caddy (e.g. after fixing DNS or starting Caddy).
route.post(
  "/teams/:teamId/apps/:appId/domains/:domainId/retry",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    if (!app.port) {
      return c.json({ error: "app_has_no_port" }, 409);
    }
    const id = c.req.param("domainId");
    if (!Types.ObjectId.isValid(id)) return c.json({ error: "not found" }, 404);
    const dom = await Domain.findOne({ _id: new Types.ObjectId(id), appId: app._id });
    if (!dom) return c.json({ error: "not found" }, 404);
    try {
      await caddy.upsertDomain(dom.host, app.port);
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

// Detach a domain.
route.delete(
  "/teams/:teamId/apps/:appId/domains/:domainId",
  requireTeamRole("admin"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const id = c.req.param("domainId");
    if (!Types.ObjectId.isValid(id)) return c.json({ error: "not found" }, 404);
    const dom = await Domain.findOne({ _id: new Types.ObjectId(id), appId: app._id });
    if (!dom) return c.json({ error: "not found" }, 404);
    await caddy.removeDomain(dom.host).catch(() => undefined);
    await dom.deleteOne();
    return c.json({ ok: true });
  },
);

export default route;
