import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { Types } from "mongoose";
import { Membership } from "../models/Membership.ts";
import { User } from "../models/User.ts";
import { readToken, SESSION_COOKIE } from "./jwt.ts";
import type { Role } from "@pmploy/shared";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
};

export type AuthVars = {
  user: AuthUser;
  membership?: { teamId: string; role: Role };
};

export const requireAuth: MiddlewareHandler<{ Variables: AuthVars }> = async (
  c,
  next,
) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: "unauthorized" }, 401);
  const payload = await readToken(token);
  if (!payload) return c.json({ error: "unauthorized" }, 401);
  const user = await User.findById(payload.sub).lean();
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", { id: String(user._id), email: user.email, name: user.name });
  await next();
};

const ROLE_RANK: Record<Role, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

export function requireTeamRole(
  minRole: Role,
  paramName = "teamId",
): MiddlewareHandler<{ Variables: AuthVars }> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const teamId = c.req.param(paramName);
    if (!teamId || !Types.ObjectId.isValid(teamId)) {
      return c.json({ error: "invalid team id" }, 400);
    }
    const membership = await Membership.findOne({
      teamId: new Types.ObjectId(teamId),
      userId: new Types.ObjectId(user.id),
    }).lean();
    if (!membership) return c.json({ error: "forbidden" }, 403);
    if (ROLE_RANK[membership.role as Role] < ROLE_RANK[minRole]) {
      return c.json({ error: "forbidden" }, 403);
    }
    c.set("membership", { teamId, role: membership.role as Role });
    await next();
  };
}

export function getAuthUser(c: Context<{ Variables: AuthVars }>): AuthUser {
  return c.get("user");
}
