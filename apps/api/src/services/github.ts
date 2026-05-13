import { App } from "@octokit/app";
import { verify } from "@octokit/webhooks-methods";
import { env } from "../env.ts";
import { getGithubAppConfig } from "./githubAppConfig.ts";

export class GithubNotConfiguredError extends Error {
  constructor() {
    super(
      "GitHub App not configured. A platform admin must register one on the platform settings page.",
    );
  }
}

type Credentials = {
  appId: string;
  privateKey: string;
  slug: string;
  webhookSecret: string;
  source: "database" | "environment";
};

async function loadCredentials(): Promise<Credentials | null> {
  const db = await getGithubAppConfig();
  if (db) {
    return {
      appId: db.appId,
      privateKey: db.privateKeyPem,
      slug: db.slug,
      webhookSecret: db.webhookSecret,
      source: "database",
    };
  }
  if (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) {
    return {
      appId: env.GITHUB_APP_ID,
      privateKey: env.GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, "\n"),
      slug: env.GITHUB_APP_SLUG ?? "",
      webhookSecret: env.GITHUB_WEBHOOK_SECRET ?? "",
      source: "environment",
    };
  }
  return null;
}

let cached: { appId: string; app: App } | null = null;

export async function isGithubConfigured(): Promise<boolean> {
  const c = await loadCredentials();
  return c !== null;
}

export async function githubApp(): Promise<App> {
  const creds = await loadCredentials();
  if (!creds) throw new GithubNotConfiguredError();
  if (cached && cached.appId === creds.appId) return cached.app;
  cached = {
    appId: creds.appId,
    app: new App({ appId: creds.appId, privateKey: creds.privateKey }),
  };
  return cached.app;
}

export type GithubAccount = {
  login: string;
  id: number;
  type: "User" | "Organization";
  avatarUrl: string;
};

export async function getInstallationAccount(installationId: number): Promise<GithubAccount> {
  const app = await githubApp();
  const { data } = await app.octokit.request(
    "GET /app/installations/{installation_id}",
    { installation_id: installationId },
  );
  const account = data.account;
  if (!account) throw new Error("installation has no account");
  const login = "login" in account ? account.login : (account as { slug?: string }).slug;
  const accountType = (data.target_type === "Organization" ? "Organization" : "User") as
    | "User"
    | "Organization";
  return {
    login: String(login ?? ""),
    id: account.id,
    type: accountType,
    avatarUrl: "avatar_url" in account ? account.avatar_url : "",
  };
}

export type GithubRepo = {
  id: number;
  fullName: string;
  name: string;
  owner: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
};

export async function listInstallationRepos(installationId: number): Promise<GithubRepo[]> {
  const app = await githubApp();
  const installation = await app.getInstallationOctokit(installationId);
  const repos: GithubRepo[] = [];
  let page = 1;
  while (true) {
    const { data } = await installation.request("GET /installation/repositories", {
      per_page: 100,
      page,
    });
    for (const r of data.repositories) {
      repos.push({
        id: r.id,
        fullName: r.full_name,
        name: r.name,
        owner: r.owner.login,
        defaultBranch: r.default_branch,
        private: r.private,
        description: r.description ?? null,
      });
    }
    if (data.repositories.length < 100) break;
    page++;
    if (page > 50) break;
  }
  return repos;
}

export type GithubBranch = { name: string; sha: string; protected: boolean };
export type HeadCommit = { sha: string; message: string; author: string };

export async function getHeadCommit(
  installationId: number,
  owner: string,
  repo: string,
  ref: string,
): Promise<HeadCommit> {
  const app = await githubApp();
  const installation = await app.getInstallationOctokit(installationId);
  const { data } = await installation.request(
    "GET /repos/{owner}/{repo}/commits/{ref}",
    { owner, repo, ref },
  );
  return {
    sha: data.sha,
    message: data.commit.message,
    author: data.commit.author?.name ?? "",
  };
}

export async function getInstallationToken(installationId: number): Promise<string> {
  const app = await githubApp();
  const result = (await app.octokit.auth({
    type: "installation",
    installationId,
  })) as { token: string };
  return result.token;
}

export async function listRepoBranches(
  installationId: number,
  owner: string,
  repo: string,
): Promise<GithubBranch[]> {
  const app = await githubApp();
  const installation = await app.getInstallationOctokit(installationId);
  const branches: GithubBranch[] = [];
  let page = 1;
  while (true) {
    const { data } = await installation.request(
      "GET /repos/{owner}/{repo}/branches",
      { owner, repo, per_page: 100, page },
    );
    for (const b of data) {
      branches.push({
        name: b.name,
        sha: b.commit.sha,
        protected: Boolean(b.protected),
      });
    }
    if (data.length < 100) break;
    page++;
    if (page > 50) break;
  }
  return branches;
}

export async function installUrl(state: string): Promise<string> {
  const creds = await loadCredentials();
  if (!creds || !creds.slug) {
    throw new Error("GitHub App slug is not set");
  }
  const u = new URL(`https://github.com/apps/${creds.slug}/installations/new`);
  u.searchParams.set("state", state);
  return u.toString();
}

/**
 * Verify a GitHub webhook signature (X-Hub-Signature-256: sha256=...).
 * Pure variant: takes the secret as an argument for testability.
 */
export async function verifyWebhookSignatureWith(
  secret: string,
  payload: string,
  signature: string | null | undefined,
): Promise<boolean> {
  if (!secret || !signature) return false;
  return verify(secret, payload, signature);
}

/** Wraps verifyWebhookSignatureWith using the configured server secret. */
export async function verifyWebhookSignature(
  payload: string,
  signature: string | null | undefined,
): Promise<boolean> {
  const creds = await loadCredentials();
  return verifyWebhookSignatureWith(creds?.webhookSecret ?? "", payload, signature);
}

/** Tests / admin actions can force the App client to rebuild on next call. */
export function _resetGithubAppCache(): void {
  cached = null;
}
