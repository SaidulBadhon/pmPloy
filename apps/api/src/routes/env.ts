import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  EnvVarInputSchema,
  type PublicEnvVar,
} from "@pmploy/shared";
import { Application } from "../models/Application.ts";
import { EnvVar, type EnvVarDoc } from "../models/EnvVar.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import {
  isEncryptionConfigured,
  seal,
} from "../services/crypto.ts";
import { recordAudit } from "../services/audit.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function view(e: EnvVarDoc): PublicEnvVar {
  return {
    id: String(e._id),
    key: e.key,
    serviceName: e.serviceName ?? "",
    createdAt: (e as EnvVarDoc & { createdAt: Date }).createdAt.toISOString(),
    updatedAt: (e as EnvVarDoc & { updatedAt: Date }).updatedAt.toISOString(),
  };
}

async function loadApp(teamId: string, appId: string) {
  if (!Types.ObjectId.isValid(teamId) || !Types.ObjectId.isValid(appId)) return null;
  return Application.findOne({
    _id: new Types.ObjectId(appId),
    teamId: new Types.ObjectId(teamId),
  });
}

route.get("/env/status", (c) =>
  c.json({ configured: isEncryptionConfigured() }),
);

// List env keys (values stay server-side; we never echo plaintext).
route.get(
  "/teams/:teamId/apps/:appId/env",
  requireTeamRole("viewer"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const vars = await EnvVar.find({ appId: app._id, serviceName: "" })
      .sort({ key: 1 })
      .lean();
    return c.json({
      vars: vars.map((v) => view(v as unknown as EnvVarDoc)),
    });
  },
);

// Upsert a key (encrypts the value).
route.put(
  "/teams/:teamId/apps/:appId/env/:key",
  requireTeamRole("member"),
  zValidator("json", EnvVarInputSchema.pick({ value: true })),
  async (c) => {
    if (!isEncryptionConfigured()) {
      return c.json({ error: "encryption_not_configured" }, 503);
    }
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const key = c.req.param("key");
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      return c.json({ error: "invalid_env_key" }, 400);
    }
    const { value } = c.req.valid("json");
    const sealed = seal(value);
    const doc = await EnvVar.findOneAndUpdate(
      { appId: app._id, serviceName: "", key },
      {
        appId: app._id,
        teamId: app.teamId,
        serviceName: "",
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
      target: { type: "env", id: String(app._id), label: `${app.name}:${key}` },
    });
    return c.json(view(doc as unknown as EnvVarDoc));
  },
);

// Delete a key.
route.delete(
  "/teams/:teamId/apps/:appId/env/:key",
  requireTeamRole("member"),
  async (c) => {
    const app = await loadApp(c.req.param("teamId"), c.req.param("appId"));
    if (!app) return c.json({ error: "not found" }, 404);
    const key = c.req.param("key");
    await EnvVar.deleteOne({ appId: app._id, serviceName: "", key });
    const user = c.get("user");
    await recordAudit({
      teamId: String(app.teamId),
      userId: user.id,
      userEmail: user.email,
      action: "env.delete",
      target: { type: "env", id: String(app._id), label: `${app.name}:${key}` },
    });
    return c.json({ ok: true });
  },
);

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

export default route;
