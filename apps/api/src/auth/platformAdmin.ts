import type { MiddlewareHandler } from "hono";
import { User } from "../models/User.ts";
import { platformAdminsFromEnv } from "../services/platform.ts";
import type { AuthVars } from "./rbac.ts";

let cachedFirstUserEmail: string | null | undefined;

async function firstUserEmail(): Promise<string | null> {
  if (cachedFirstUserEmail !== undefined) return cachedFirstUserEmail;
  const first = await User.findOne()
    .sort({ createdAt: 1 })
    .select("email")
    .lean();
  cachedFirstUserEmail = first?.email?.toLowerCase() ?? null;
  return cachedFirstUserEmail;
}

/**
 * Lets the auth tests reset the cache between runs.
 * Not for production use.
 */
export function _resetPlatformAdminCache(): void {
  cachedFirstUserEmail = undefined;
}

export async function isPlatformAdmin(email: string): Promise<boolean> {
  const e = email.toLowerCase();
  const env = platformAdminsFromEnv();
  if (env.length > 0) return env.includes(e);
  const first = await firstUserEmail();
  return first !== null && first === e;
}

export const requirePlatformAdmin: MiddlewareHandler<{ Variables: AuthVars }> =
  async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    if (!(await isPlatformAdmin(user.email))) {
      return c.json({ error: "forbidden", message: "platform admin only" }, 403);
    }
    await next();
  };
