import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_HOST: z.string().default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().default("mongodb://localhost:27017/pmploy"),
  JWT_SECRET: z.string().min(16).default("dev-secret-change-me-please-32chars"),
  ENV_ENCRYPTION_KEY: z.string().default(""),
  CADDY_ADMIN_URL: z.string().url().default("http://localhost:2019"),
  PMPLOY_DATA_DIR: z.string().default("./.pmploy-data"),
  PMPLOY_REPO_PATH: z.string().default(process.cwd()),
  PLATFORM_ADMINS: z.string().default(""),
  GITHUB_APP_ID: z.string().optional(),
  GITHUB_APP_PRIVATE_KEY: z.string().optional(),
  GITHUB_WEBHOOK_SECRET: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
});

export const env = schema.parse(process.env);
export type Env = z.infer<typeof schema>;
