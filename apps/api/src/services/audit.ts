import { Types } from "mongoose";
import { AuditLog } from "../models/AuditLog.ts";

export type AuditTarget = "app" | "domain" | "member" | "team" | "env" | "github";

export type AuditArgs = {
  teamId: string;
  userId?: string;
  userEmail?: string;
  action: string;
  target?: { type: AuditTarget; id: string; label?: string };
  meta?: Record<string, unknown> | null;
};

/** Best-effort audit write. Never throws — auditing must not break a request. */
export async function recordAudit(args: AuditArgs): Promise<void> {
  try {
    await AuditLog.create({
      teamId: new Types.ObjectId(args.teamId),
      userId: args.userId ? new Types.ObjectId(args.userId) : undefined,
      userEmail: args.userEmail ?? "",
      action: args.action,
      targetType: args.target?.type ?? "",
      targetId: args.target?.id ?? "",
      targetLabel: args.target?.label ?? "",
      meta: args.meta ?? null,
    });
  } catch (err) {
    console.error("[audit] failed:", err);
  }
}
