import type { Context } from "hono";
import { Hono } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";
import { zValidator } from "@hono/zod-validator";
import {
  LoginInputSchema,
  SignupInputSchema,
  type MeResponse,
  type Role,
} from "@pmploy/shared";
import { env } from "../env.ts";
import { User } from "../models/User.ts";
import { Team } from "../models/Team.ts";
import { Membership } from "../models/Membership.ts";
import { hashPassword, verifyPassword } from "../auth/password.ts";
import { issueToken, SESSION_COOKIE, SESSION_MAX_AGE } from "../auth/jwt.ts";
import { requireAuth, type AuthVars } from "../auth/rbac.ts";
import { slugify, randomSuffix } from "../lib/slug.ts";

const isProd = env.NODE_ENV === "production";

function setSessionCookie(c: Context, token: string) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isProd,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

const route = new Hono<{ Variables: AuthVars }>();

route.post("/signup", zValidator("json", SignupInputSchema), async (c) => {
  const { email, name, password, teamName } = c.req.valid("json");
  const existing = await User.findOne({ email: email.toLowerCase() }).lean();
  if (existing) return c.json({ error: "email already in use" }, 409);

  const passwordHash = await hashPassword(password);
  const user = await User.create({ email, name, passwordHash });

  let slug = slugify(teamName) || "team";
  while (await Team.findOne({ slug }).lean()) {
    slug = `${slugify(teamName) || "team"}-${randomSuffix()}`;
  }
  const team = await Team.create({ name: teamName, slug, ownerId: user._id });
  await Membership.create({ userId: user._id, teamId: team._id, role: "owner" });

  const token = await issueToken({ id: String(user._id), email: user.email });
  setSessionCookie(c, token);
  return c.json(
    {
      user: { id: String(user._id), email: user.email, name: user.name },
      teams: [
        { id: String(team._id), name: team.name, slug: team.slug, role: "owner" as Role },
      ],
    } satisfies MeResponse,
    201,
  );
});

route.post("/login", zValidator("json", LoginInputSchema), async (c) => {
  const { email, password } = c.req.valid("json");
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) return c.json({ error: "invalid credentials" }, 401);
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) return c.json({ error: "invalid credentials" }, 401);

  const token = await issueToken({ id: String(user._id), email: user.email });
  setSessionCookie(c, token);
  return c.json({ ok: true });
});

route.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

route.get("/me", requireAuth, async (c) => {
  const user = c.get("user");
  const memberships = await Membership.find({ userId: user.id })
    .populate<{ teamId: { _id: unknown; name: string; slug: string } }>("teamId")
    .lean();
  const teams = memberships
    .filter((m) => m.teamId && typeof m.teamId === "object")
    .map((m) => ({
      id: String((m.teamId as { _id: unknown })._id),
      name: (m.teamId as { name: string }).name,
      slug: (m.teamId as { slug: string }).slug,
      role: m.role as Role,
    }));
  return c.json({ user, teams } satisfies MeResponse);
});

export default route;
