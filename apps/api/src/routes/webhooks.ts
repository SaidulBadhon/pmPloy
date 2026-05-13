import { Hono } from "hono";
import { Application } from "../models/Application.ts";
import { GithubInstallation } from "../models/GithubInstallation.ts";
import { verifyWebhookSignature } from "../services/github.ts";
import { enqueueDeploy } from "../services/deploy.ts";

const route = new Hono();

/**
 * GitHub webhook receiver. We must read the raw body first to verify the
 * HMAC signature; afterwards we parse it as JSON and dispatch by event type.
 */
route.post("/webhooks/github", async (c) => {
  const event = c.req.header("x-github-event") ?? "";
  const signature = c.req.header("x-hub-signature-256");
  const raw = await c.req.text();

  const ok = await verifyWebhookSignature(raw, signature);
  if (!ok) return c.json({ error: "invalid signature" }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  if (event === "ping") {
    return c.json({ ok: true });
  }

  if (event !== "push") {
    return c.json({ ok: true, ignored: event });
  }

  const push = payload as {
    ref?: string;
    after?: string;
    head_commit?: { message?: string; author?: { name?: string } };
    repository?: { full_name?: string };
    installation?: { id?: number };
  };

  const ref = push.ref ?? "";
  const repo = push.repository?.full_name ?? "";
  const installationId = push.installation?.id;
  if (!ref.startsWith("refs/heads/") || !repo || !installationId) {
    return c.json({ ok: true, ignored: "incomplete push" });
  }
  const branch = ref.slice("refs/heads/".length);

  // Find apps that belong to a team that has this installation and that are
  // configured to track this repo+branch.
  const installations = await GithubInstallation.find({ installationId })
    .select("teamId")
    .lean();
  if (installations.length === 0) {
    return c.json({ ok: true, ignored: "unknown installation" });
  }
  const teamIds = installations.map((i) => i.teamId);

  const apps = await Application.find({
    teamId: { $in: teamIds },
    sourceType: "github",
    "github.installationId": installationId,
    "github.repo": repo,
    "github.branch": branch,
  });

  const deployed: string[] = [];
  for (const app of apps) {
    try {
      const dep = await enqueueDeploy({
        appId: String(app._id),
        triggeredBy: "webhook",
        branch,
        commitSha: push.after,
      });
      deployed.push(String(dep._id));
    } catch (err) {
      console.error(`[webhook] enqueue failed for app ${app._id}:`, err);
    }
  }

  return c.json({ ok: true, deployed });
});

export default route;
