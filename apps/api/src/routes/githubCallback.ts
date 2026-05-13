import { Hono } from "hono";
import { Types } from "mongoose";
import { requireAuth, type AuthVars } from "../auth/rbac.ts";
import { GithubInstallation } from "../models/GithubInstallation.ts";
import { Membership } from "../models/Membership.ts";
import {
  getInstallationAccount,
  isGithubConfigured,
} from "../services/github.ts";

const route = new Hono<{ Variables: AuthVars }>();

/**
 * GitHub redirects here after a user installs (or updates) the App.
 * Query params:
 *   installation_id - numeric
 *   setup_action    - "install" | "update"
 *   state           - the teamId we sent on the install URL
 *
 * We require the caller to be authenticated and be at least admin on the team.
 */
route.get("/github/callback", requireAuth, async (c) => {
  if (!(await isGithubConfigured())) {
    return c.json({ error: "github_not_configured" }, 503);
  }
  const installationIdRaw = c.req.query("installation_id");
  const teamId = c.req.query("state");
  if (!installationIdRaw || !teamId) {
    return c.json({ error: "missing installation_id or state" }, 400);
  }
  const installationId = Number(installationIdRaw);
  if (!Number.isInteger(installationId) || !Types.ObjectId.isValid(teamId)) {
    return c.json({ error: "invalid params" }, 400);
  }
  const user = c.get("user");
  const m = await Membership.findOne({
    teamId: new Types.ObjectId(teamId),
    userId: new Types.ObjectId(user.id),
  }).lean();
  if (!m || (m.role !== "owner" && m.role !== "admin")) {
    return c.json({ error: "forbidden" }, 403);
  }

  try {
    const account = await getInstallationAccount(installationId);
    await GithubInstallation.findOneAndUpdate(
      { teamId: new Types.ObjectId(teamId), installationId },
      {
        teamId: new Types.ObjectId(teamId),
        installationId,
        accountLogin: account.login,
        accountId: account.id,
        accountType: account.type,
        avatarUrl: account.avatarUrl,
      },
      { upsert: true, new: true },
    );
  } catch (err) {
    return c.json(
      { error: "installation_lookup_failed", message: (err as Error).message },
      400,
    );
  }

  // Send the user back to the GitHub settings page.
  return c.redirect(`/settings/github?team=${teamId}`);
});

export default route;
