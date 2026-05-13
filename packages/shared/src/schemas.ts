import { z } from "zod";

export const RoleSchema = z.enum(["owner", "admin", "member", "viewer"]);
export type Role = z.infer<typeof RoleSchema>;

export const DeploymentStatusSchema = z.enum([
  "queued",
  "building",
  "live",
  "failed",
  "cancelled",
]);
export type DeploymentStatus = z.infer<typeof DeploymentStatusSchema>;

export const AppStatusSchema = z.enum([
  "created",
  "deploying",
  "running",
  "stopped",
  "errored",
]);
export type AppStatus = z.infer<typeof AppStatusSchema>;

export const HealthSchema = z.object({
  status: z.literal("ok"),
  db: z.enum(["connected", "connecting", "disconnected", "disconnecting"]),
  uptime: z.number(),
});
export type Health = z.infer<typeof HealthSchema>;
