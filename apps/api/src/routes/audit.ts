import { Hono } from "hono";
import { Types } from "mongoose";
import type { PublicAuditEntry } from "@pmploy/shared";
import { AuditLog, type AuditLogDoc } from "../models/AuditLog.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

route.get("/teams/:teamId/audit", requireTeamRole("viewer"), async (c) => {
  const teamId = c.req.param("teamId");
  const limit = Math.min(Number(c.req.query("limit") ?? 100), 500);
  const docs = await AuditLog.find({ teamId: new Types.ObjectId(teamId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();
  const entries: PublicAuditEntry[] = docs.map((d) => ({
    id: String(d._id),
    teamId: String(d.teamId),
    userEmail: d.userEmail ?? "",
    action: d.action,
    targetType: d.targetType ?? "",
    targetId: d.targetId ?? "",
    targetLabel: d.targetLabel ?? "",
    meta: (d.meta ?? null) as unknown,
    createdAt: (d as AuditLogDoc & { createdAt: Date }).createdAt.toISOString(),
  }));
  return c.json({ entries });
});

export default route;
