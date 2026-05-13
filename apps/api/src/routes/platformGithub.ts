import { Hono } from "hono";
import { requireAuth, type AuthVars } from "../auth/rbac.ts";
import { requirePlatformAdmin } from "../auth/platformAdmin.ts";
import { env } from "../env.ts";
import {
  clearGithubAppConfig,
  getGithubAppConfig,
  setGithubAppConfig,
} from "../services/githubAppConfig.ts";
import { _resetGithubAppCache } from "../services/github.ts";
import { signManifestState, verifyManifestState } from "../lib/manifestState.ts";
import type {
  GithubAppStatus,
  RegisterManifestResponse,
} from "@pmploy/shared";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

function originFromRequest(reqUrl: string): string {
  if (env.PUBLIC_ORIGIN) return env.PUBLIC_ORIGIN.replace(/\/$/, "");
  return new URL(reqUrl).origin;
}

route.get("/platform/github", requirePlatformAdmin, async (c) => {
  const cfg = await getGithubAppConfig();
  if (cfg) {
    return c.json({
      configured: true,
      appId: cfg.appId,
      slug: cfg.slug,
      htmlUrl: cfg.htmlUrl || null,
      source: "database",
    } satisfies GithubAppStatus);
  }
  if (env.GITHUB_APP_ID) {
    return c.json({
      configured: true,
      appId: env.GITHUB_APP_ID,
      slug: env.GITHUB_APP_SLUG ?? null,
      htmlUrl: null,
      source: "environment",
    } satisfies GithubAppStatus);
  }
  return c.json({
    configured: false, appId: null, slug: null, htmlUrl: null, source: "none",
  } satisfies GithubAppStatus);
});

route.post("/platform/github/manifest", requirePlatformAdmin, async (c) => {
  const user = c.get("user");
  const origin = originFromRequest(c.req.url);
  const state = await signManifestState(env.JWT_SECRET, user.id);

  // App-name suffix: short random so re-registering doesn't clash on existing slug.
  const suffix = Math.random().toString(36).slice(2, 8);
  const manifest = {
    name: `pmploy-${suffix}`,
    url: origin,
    hook_attributes: { url: `${origin}/api/webhooks/github`, active: true },
    redirect_url: `${origin}/api/platform/github/manifest/callback`,
    setup_url: `${origin}/settings/platform/github`,
    callback_urls: [`${origin}/api/github/callback`],
    public: false,
    default_permissions: {
      contents: "read",
      metadata: "read",
      pull_requests: "read",
      issues: "read",
      checks: "write",
      deployments: "write",
      statuses: "write",
    },
    default_events: ["push", "pull_request"],
  };
  return c.json({
    action: "https://github.com/settings/apps/new",
    state,
    manifest: JSON.stringify(manifest),
  } satisfies RegisterManifestResponse);
});

route.get("/platform/github/manifest/callback", requirePlatformAdmin, async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.json({ error: "missing code or state" }, 400);
  }
  const verified = await verifyManifestState(env.JWT_SECRET, state);
  if (!verified) {
    return c.json({ error: "invalid_state" }, 400);
  }
  const user = c.get("user");
  if (verified.userId !== user.id) {
    return c.json({ error: "state_user_mismatch" }, 403);
  }

  const res = await fetch(`https://api.github.com/app-manifests/${code}/conversions`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text();
    return c.json(
      { error: "manifest_exchange_failed", status: res.status, body: text },
      502,
    );
  }
  const data = (await res.json()) as {
    id: number; slug: string; html_url: string; name: string;
    client_id: string; client_secret: string; webhook_secret: string; pem: string;
  };

  await setGithubAppConfig({
    appId: String(data.id),
    slug: data.slug,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    webhookSecret: data.webhook_secret,
    privateKeyPem: data.pem,
    htmlUrl: data.html_url,
    name: data.name,
  });
  _resetGithubAppCache();
  return c.redirect("/settings/platform/github?registered=1");
});

route.delete("/platform/github", requirePlatformAdmin, async (c) => {
  await clearGithubAppConfig();
  _resetGithubAppCache();
  return c.json({ ok: true });
});

export default route;
