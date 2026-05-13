import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { Types } from "mongoose";
import {
  ConnectInstallationInputSchema,
  type GithubInstallation as PublicGithubInstallation,
} from "@pmploy/shared";
import { GithubInstallation } from "../models/GithubInstallation.ts";
import { requireAuth, requireTeamRole, type AuthVars } from "../auth/rbac.ts";
import {
  GithubNotConfiguredError,
  getInstallationAccount,
  installUrl,
  isGithubConfigured,
  listInstallationRepos,
  listRepoBranches,
} from "../services/github.ts";
import type { GithubInstallationDoc } from "../models/GithubInstallation.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function installationView(doc: GithubInstallationDoc): PublicGithubInstallation {
  return {
    id: String(doc._id),
    installationId: doc.installationId,
    accountLogin: doc.accountLogin,
    accountType: doc.accountType,
    avatarUrl: doc.avatarUrl ?? "",
  };
}

// Config probe so the UI can show a setup hint when the GitHub App isn't set up.
route.get("/teams/:teamId/github/status", requireTeamRole("viewer"), async (c) =>
  c.json({ configured: await isGithubConfigured() }),
);

// Returns the URL the user should visit to install the GitHub App on their org.
route.get("/teams/:teamId/github/install-url", requireTeamRole("admin"), async (c) => {
  if (!(await isGithubConfigured())) {
    return c.json({ error: "github_not_configured" }, 503);
  }
  try {
    const url = await installUrl(c.req.param("teamId"));
    return c.json({ url });
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

// List installations connected to this team.
route.get(
  "/teams/:teamId/github/installations",
  requireTeamRole("viewer"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const docs = await GithubInstallation.find({
      teamId: new Types.ObjectId(teamId),
    }).lean();
    return c.json({
      installations: docs.map((d) =>
        installationView(d as unknown as GithubInstallationDoc),
      ),
    });
  },
);

// Register an installation against this team (idempotent).
route.post(
  "/teams/:teamId/github/installations",
  requireTeamRole("admin"),
  zValidator("json", ConnectInstallationInputSchema),
  async (c) => {
    if (!(await isGithubConfigured())) {
      return c.json({ error: "github_not_configured" }, 503);
    }
    const teamId = c.req.param("teamId");
    const { installationId } = c.req.valid("json");

    let account;
    try {
      account = await getInstallationAccount(installationId);
    } catch (err) {
      if (err instanceof GithubNotConfiguredError) {
        return c.json({ error: "github_not_configured" }, 503);
      }
      return c.json(
        { error: "installation_lookup_failed", message: (err as Error).message },
        400,
      );
    }

    const doc = await GithubInstallation.findOneAndUpdate(
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
    return c.json(installationView(doc as unknown as GithubInstallationDoc), 201);
  },
);

route.delete(
  "/teams/:teamId/github/installations/:installationId",
  requireTeamRole("admin"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const installationId = Number(c.req.param("installationId"));
    if (!Number.isInteger(installationId)) {
      return c.json({ error: "invalid installation id" }, 400);
    }
    await GithubInstallation.deleteOne({
      teamId: new Types.ObjectId(teamId),
      installationId,
    });
    return c.json({ ok: true });
  },
);

async function findInstallation(teamId: string, installationId: number) {
  return GithubInstallation.findOne({
    teamId: new Types.ObjectId(teamId),
    installationId,
  }).lean();
}

route.get(
  "/teams/:teamId/github/installations/:installationId/repos",
  requireTeamRole("viewer"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const installationId = Number(c.req.param("installationId"));
    if (!Number.isInteger(installationId)) {
      return c.json({ error: "invalid installation id" }, 400);
    }
    const inst = await findInstallation(teamId, installationId);
    if (!inst) return c.json({ error: "installation not on this team" }, 404);
    try {
      const repos = await listInstallationRepos(installationId);
      return c.json({ repos });
    } catch (err) {
      return c.json(
        { error: "repo_list_failed", message: (err as Error).message },
        502,
      );
    }
  },
);

route.get(
  "/teams/:teamId/github/installations/:installationId/repos/:owner/:repo/branches",
  requireTeamRole("viewer"),
  async (c) => {
    const teamId = c.req.param("teamId");
    const installationId = Number(c.req.param("installationId"));
    const owner = c.req.param("owner");
    const repo = c.req.param("repo");
    if (!Number.isInteger(installationId)) {
      return c.json({ error: "invalid installation id" }, 400);
    }
    const inst = await findInstallation(teamId, installationId);
    if (!inst) return c.json({ error: "installation not on this team" }, 404);
    try {
      const branches = await listRepoBranches(installationId, owner, repo);
      return c.json({ branches });
    } catch (err) {
      return c.json(
        { error: "branch_list_failed", message: (err as Error).message },
        502,
      );
    }
  },
);

export default route;
