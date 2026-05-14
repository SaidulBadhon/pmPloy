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
  "degraded",
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

export const PublicServiceSchema = z.object({
  name: z.string(),
  pm2Name: z.string(),
  port: z.number().nullable(),
  isPrimary: z.boolean(),
  pm2: Pm2InfoSchema.nullable(),
});
export type PublicService = z.infer<typeof PublicServiceSchema>;

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
  services: z.array(PublicServiceSchema),
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

// --- GitHub App (platform-level) ---

export const GithubAppStatusSchema = z.object({
  configured: z.boolean(),
  appId: z.string().nullable(),
  slug: z.string().nullable(),
  htmlUrl: z.string().nullable(),
  source: z.enum(["database", "environment", "none"]),
});
export type GithubAppStatus = z.infer<typeof GithubAppStatusSchema>;

export const RegisterManifestResponseSchema = z.object({
  action: z.string().url(),       // where the form should POST (github.com/settings/apps/new)
  state: z.string(),              // signed state token (goes in the URL query)
  manifest: z.string(),           // JSON-stringified manifest, posted as a form field
});
export type RegisterManifestResponse = z.infer<typeof RegisterManifestResponseSchema>;

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

// --- Domains ---

// RFC 1035 hostname-ish: letters, digits, dot, hyphen. No protocol, no slash.
const HOST_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

export const SslStatusSchema = z.enum(["pending", "active", "error", "unknown"]);
export type SslStatus = z.infer<typeof SslStatusSchema>;

export const AttachDomainInputSchema = z.object({
  host: z
    .string()
    .trim()
    .toLowerCase()
    .max(253)
    .regex(HOST_REGEX, "invalid hostname"),
  serviceName: z.string().trim().max(80).optional().default(""),
});
export type AttachDomainInput = z.infer<typeof AttachDomainInputSchema>;

export const PublicDomainSchema = z.object({
  id: z.string(),
  appId: z.string(),
  teamId: z.string(),
  host: z.string(),
  sslStatus: SslStatusSchema,
  lastError: z.string(),
  serviceName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type PublicDomain = z.infer<typeof PublicDomainSchema>;

export const CaddyStatusSchema = z.object({
  reachable: z.boolean(),
});
export type CaddyStatus = z.infer<typeof CaddyStatusSchema>;

// --- Env vars ---

export const ENV_KEY_REGEX = /^[A-Z_][A-Z0-9_]*$/;

export const EnvVarInputSchema = z.object({
  key: z.string().trim().min(1).max(120).regex(ENV_KEY_REGEX, "use UPPER_SNAKE_CASE"),
  value: z.string().max(8192),
});
export type EnvVarInput = z.infer<typeof EnvVarInputSchema>;

export const PublicEnvVarSchema = z.object({
  id: z.string(),
  key: z.string(),
  // values are write-only; never echoed back to clients.
  updatedAt: z.string(),
  createdAt: z.string(),
});
export type PublicEnvVar = z.infer<typeof PublicEnvVarSchema>;

// --- Audit log ---

export const PublicAuditEntrySchema = z.object({
  id: z.string(),
  teamId: z.string(),
  userEmail: z.string(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string(),
  targetLabel: z.string(),
  meta: z.unknown().nullable(),
  createdAt: z.string(),
});
export type PublicAuditEntry = z.infer<typeof PublicAuditEntrySchema>;

// --- Platform self-update ---

export const CommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  author: z.string(),
  authoredAt: z.string(),
});
export type Commit = z.infer<typeof CommitSchema>;

export const PlatformInfoSchema = z.object({
  repoPath: z.string(),
  branch: z.string(),
  head: CommitSchema.nullable(),
  dirty: z.boolean(),
  trackingUpstream: z.boolean(),
  isPlatformAdmin: z.boolean(),
});
export type PlatformInfo = z.infer<typeof PlatformInfoSchema>;

export const PlatformCheckResultSchema = z.object({
  pending: z.array(CommitSchema),
  updateInProgress: z.boolean(),
});
export type PlatformCheckResult = z.infer<typeof PlatformCheckResultSchema>;

export const PlatformStatusSchema = z.object({
  inProgress: z.boolean(),
  log: z.string(),
});
export type PlatformStatus = z.infer<typeof PlatformStatusSchema>;

export const TriggerUpdateInputSchema = z.object({
  target: z.string().trim().min(1).max(120).optional(),
});
export type TriggerUpdateInput = z.infer<typeof TriggerUpdateInputSchema>;
