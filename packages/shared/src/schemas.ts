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

// --- Applications ---

export const ExecModeSchema = z.enum(["fork", "cluster"]);
export type ExecMode = z.infer<typeof ExecModeSchema>;

export const GithubSourceInputSchema = z.object({
  installationId: z.number().int().positive(),
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/, "expected owner/name"),
  branch: z.string().trim().min(1).max(120),
  rootDir: z.string().trim().max(200).optional().default(""),
  buildCommand: z.string().trim().max(400).optional().default(""),
});
export type GithubSourceInput = z.infer<typeof GithubSourceInputSchema>;

const baseAppInput = z.object({
  name: z.string().trim().min(1).max(80),
  script: z.string().trim().min(1),
  interpreter: z.string().trim().max(40).optional().default(""),
  instances: z.number().int().min(1).max(64).default(1),
  execMode: ExecModeSchema.default("fork"),
});

export const CreateApplicationInputSchema = z.discriminatedUnion("sourceType", [
  baseAppInput.extend({
    sourceType: z.literal("local"),
    cwd: z.string().trim().min(1),
  }),
  baseAppInput.extend({
    sourceType: z.literal("github"),
    github: GithubSourceInputSchema,
  }),
]);
export type CreateApplicationInput = z.infer<typeof CreateApplicationInputSchema>;

export const UpdateApplicationInputSchema = baseAppInput
  .extend({
    cwd: z.string().trim().min(1).optional(),
    github: GithubSourceInputSchema.partial().optional(),
  })
  .partial();
export type UpdateApplicationInput = z.infer<typeof UpdateApplicationInputSchema>;

export const Pm2StatusSchema = z.enum([
  "online",
  "stopping",
  "stopped",
  "launching",
  "errored",
  "one-launch-status",
  "unknown",
]);
export type Pm2Status = z.infer<typeof Pm2StatusSchema>;

export const Pm2InfoSchema = z.object({
  name: z.string(),
  pid: z.number(),
  status: Pm2StatusSchema,
  cpu: z.number(),
  memory: z.number(),
  uptime: z.number(),
  restarts: z.number(),
});
export type Pm2Info = z.infer<typeof Pm2InfoSchema>;

export const GithubSourceSchema = z.object({
  installationId: z.number(),
  repo: z.string(),
  branch: z.string(),
  rootDir: z.string(),
  buildCommand: z.string(),
});
export type GithubSource = z.infer<typeof GithubSourceSchema>;

export const PublicApplicationSchema = z.object({
  id: z.string(),
  teamId: z.string(),
  name: z.string(),
  slug: z.string(),
  sourceType: z.enum(["local", "github"]),
  cwd: z.string(),
  script: z.string(),
  interpreter: z.string(),
  instances: z.number(),
  execMode: ExecModeSchema,
  github: GithubSourceSchema.nullable(),
  port: z.number().nullable(),
  status: AppStatusSchema,
  pm2Name: z.string(),
  pm2: Pm2InfoSchema.nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicApplication = z.infer<typeof PublicApplicationSchema>;

// --- GitHub ---

export const GithubInstallationSchema = z.object({
  id: z.string(),
  installationId: z.number(),
  accountLogin: z.string(),
  accountType: z.enum(["User", "Organization"]),
  avatarUrl: z.string(),
});
export type GithubInstallation = z.infer<typeof GithubInstallationSchema>;

export const GithubRepoSchema = z.object({
  id: z.number(),
  fullName: z.string(),
  name: z.string(),
  owner: z.string(),
  defaultBranch: z.string(),
  private: z.boolean(),
  description: z.string().nullable(),
});
export type GithubRepo = z.infer<typeof GithubRepoSchema>;

export const GithubBranchSchema = z.object({
  name: z.string(),
  sha: z.string(),
  protected: z.boolean(),
});
export type GithubBranch = z.infer<typeof GithubBranchSchema>;

export const ConnectInstallationInputSchema = z.object({
  installationId: z.number().int().positive(),
});
export type ConnectInstallationInput = z.infer<typeof ConnectInstallationInputSchema>;

// --- Deployments ---

export const PublicDeploymentSchema = z.object({
  id: z.string(),
  appId: z.string(),
  teamId: z.string(),
  status: DeploymentStatusSchema,
  triggeredBy: z.enum(["webhook", "manual", "user"]),
  commitSha: z.string(),
  commitMessage: z.string(),
  branch: z.string(),
  errorMessage: z.string(),
  workdir: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicDeployment = z.infer<typeof PublicDeploymentSchema>;

export const PublicDeploymentWithLogsSchema = PublicDeploymentSchema.extend({
  logs: z.array(z.string()),
});
export type PublicDeploymentWithLogs = z.infer<typeof PublicDeploymentWithLogsSchema>;

export const TriggerDeployInputSchema = z.object({
  commitSha: z.string().trim().optional(),
  branch: z.string().trim().optional(),
});
export type TriggerDeployInput = z.infer<typeof TriggerDeployInputSchema>;

export const DeployLogEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("log"), line: z.string() }),
  z.object({ type: z.literal("status"), status: z.string() }),
  z.object({ type: z.literal("done") }),
]);
export type DeployLogEvent = z.infer<typeof DeployLogEventSchema>;
