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

// --- Auth ---

export const SignupInputSchema = z.object({
  email: z.string().email(),
  name: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(200),
  teamName: z.string().trim().min(1).max(80),
});
export type SignupInput = z.infer<typeof SignupInputSchema>;

export const LoginInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const PublicUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
});
export type PublicUser = z.infer<typeof PublicUserSchema>;

export const PublicTeamSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: RoleSchema,
});
export type PublicTeam = z.infer<typeof PublicTeamSchema>;

export const MeResponseSchema = z.object({
  user: PublicUserSchema,
  teams: z.array(PublicTeamSchema),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- Teams ---

export const CreateTeamInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
});
export type CreateTeamInput = z.infer<typeof CreateTeamInputSchema>;

export const InviteMemberInputSchema = z.object({
  email: z.string().email(),
  role: RoleSchema.exclude(["owner"]),
});
export type InviteMemberInput = z.infer<typeof InviteMemberInputSchema>;

export const UpdateMemberRoleInputSchema = z.object({
  role: RoleSchema.exclude(["owner"]),
});
export type UpdateMemberRoleInput = z.infer<typeof UpdateMemberRoleInputSchema>;

export const TeamMemberSchema = z.object({
  userId: z.string(),
  email: z.string(),
  name: z.string(),
  role: RoleSchema,
});
export type TeamMember = z.infer<typeof TeamMemberSchema>;
