import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  CreateTeamInputSchema,
  InviteMemberInputSchema,
  UpdateMemberRoleInputSchema,
  type Role,
  type TeamMember,
} from "@pmploy/shared";
import { Team } from "../models/Team.ts";
import { Membership } from "../models/Membership.ts";
import { User } from "../models/User.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import { slugify, randomSuffix } from "../lib/slug.ts";
import { recordAudit } from "../services/audit.ts";

const route = new Hono<{ Variables: AuthVars }>();

// All team routes require auth.
route.use("*", requireAuth);

// List teams the user belongs to.
route.get("/", async (c) => {
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
  return c.json({ teams });
});

// Create a new team; creator becomes owner.
route.post("/", zValidator("json", CreateTeamInputSchema), async (c) => {
  const user = c.get("user");
  const { name } = c.req.valid("json");
  let slug = slugify(name) || "team";
  while (await Team.findOne({ slug }).lean()) {
    slug = `${slugify(name) || "team"}-${randomSuffix()}`;
  }
  const team = await Team.create({ name, slug, ownerId: user.id });
  await Membership.create({ userId: user.id, teamId: team._id, role: "owner" });
  return c.json(
    {
      id: String(team._id),
      name: team.name,
      slug: team.slug,
      role: "owner" satisfies Role,
    },
    201,
  );
});

// Read a single team (any member).
route.get("/:teamId", requireTeamRole("viewer"), async (c) => {
  const team = await Team.findById(c.req.param("teamId")).lean();
  if (!team) return c.json({ error: "not found" }, 404);
  const m = c.get("membership")!;
  return c.json({
    id: String(team._id),
    name: team.name,
    slug: team.slug,
    role: m.role,
  });
});

// Rename a team (admin or owner).
route.patch(
  "/:teamId",
  requireTeamRole("admin"),
  zValidator("json", CreateTeamInputSchema),
  async (c) => {
    const { name } = c.req.valid("json");
    const team = await Team.findByIdAndUpdate(
      c.req.param("teamId"),
      { name },
      { new: true },
    ).lean();
    if (!team) return c.json({ error: "not found" }, 404);
    return c.json({ id: String(team._id), name: team.name, slug: team.slug });
  },
);

// Delete a team (owner only).
route.delete("/:teamId", requireTeamRole("owner"), async (c) => {
  const teamId = c.req.param("teamId");
  await Membership.deleteMany({ teamId: new Types.ObjectId(teamId) });
  await Team.findByIdAndDelete(teamId);
  return c.json({ ok: true });
});

// List team members (any member).
route.get("/:teamId/members", requireTeamRole("viewer"), async (c) => {
  const teamId = c.req.param("teamId");
  const memberships = await Membership.find({
    teamId: new Types.ObjectId(teamId),
  })
    .populate<{ userId: { _id: unknown; email: string; name: string } }>("userId")
    .lean();
  const members: TeamMember[] = memberships
    .filter((m) => m.userId && typeof m.userId === "object")
    .map((m) => ({
      userId: String((m.userId as { _id: unknown })._id),
      email: (m.userId as { email: string }).email,
      name: (m.userId as { name: string }).name,
      role: m.role as Role,
    }));
  return c.json({ members });
});

// Add a member by email (admin or owner).
route.post(
  "/:teamId/members",
  requireTeamRole("admin"),
  zValidator("json", InviteMemberInputSchema),
  async (c) => {
    const teamId = c.req.param("teamId");
    const { email, role } = c.req.valid("json");
    const user = await User.findOne({ email: email.toLowerCase() }).lean();
    if (!user) return c.json({ error: "user not found" }, 404);
    const existing = await Membership.findOne({
      teamId: new Types.ObjectId(teamId),
      userId: user._id,
    }).lean();
    if (existing) return c.json({ error: "already a member" }, 409);
    await Membership.create({ teamId, userId: user._id, role });
    const actor = c.get("user");
    await recordAudit({
      teamId,
      userId: actor.id,
      userEmail: actor.email,
      action: "member.add",
      target: { type: "member", id: String(user._id), label: user.email },
      meta: { role },
    });
    return c.json(
      {
        userId: String(user._id),
        email: user.email,
        name: user.name,
        role,
      } satisfies TeamMember,
      201,
    );
  },
);

// Update a member's role (admin or owner; cannot demote the team owner).
route.patch(
  "/:teamId/members/:userId",
  requireTeamRole("admin"),
  zValidator("json", UpdateMemberRoleInputSchema),
  async (c) => {
    const teamId = c.req.param("teamId");
    const userId = c.req.param("userId");
    const team = await Team.findById(teamId).lean();
    if (!team) return c.json({ error: "team not found" }, 404);
    if (String(team.ownerId) === userId) {
      return c.json({ error: "cannot change owner role" }, 400);
    }
    const { role } = c.req.valid("json");
    const m = await Membership.findOneAndUpdate(
      { teamId: new Types.ObjectId(teamId), userId: new Types.ObjectId(userId) },
      { role },
      { new: true },
    ).lean();
    if (!m) return c.json({ error: "membership not found" }, 404);
    const actor = c.get("user");
    await recordAudit({
      teamId,
      userId: actor.id,
      userEmail: actor.email,
      action: "member.role_change",
      target: { type: "member", id: userId },
      meta: { role: m.role },
    });
    return c.json({ ok: true, role: m.role });
  },
);

// Remove a member (admin or owner; cannot remove team owner).
route.delete(
  "/:teamId/members/:userId",
  requireTeamRole("admin"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const userId = c.req.param("userId");
    const team = await Team.findById(teamId).lean();
    if (!team) return c.json({ error: "team not found" }, 404);
    if (String(team.ownerId) === userId) {
      return c.json({ error: "cannot remove team owner" }, 400);
    }
    await Membership.deleteOne({
      teamId: new Types.ObjectId(teamId),
      userId: new Types.ObjectId(userId),
    });
    const actor = c.get("user");
    await recordAudit({
      teamId,
      userId: actor.id,
      userEmail: actor.email,
      action: "member.remove",
      target: { type: "member", id: userId },
    });
    return c.json({ ok: true });
  },
);

export default route;
