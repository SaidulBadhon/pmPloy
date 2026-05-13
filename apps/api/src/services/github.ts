import { App } from "@octokit/app";
import { verify } from "@octokit/webhooks-methods";
import { env } from "../env.ts";

export class GithubNotConfiguredError extends Error {
  constructor() {
    super(
      "GitHub App not configured. Set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_APP_SLUG.",
    );
  }
}

let cached: App | null = null;

export function isGithubConfigured(): boolean {
  return Boolean(env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY);
}

export function githubApp(): App {
  if (!isGithubConfigured()) throw new GithubNotConfiguredError();
  if (cached) return cached;
  cached = new App({
    appId: env.GITHUB_APP_ID!,
    // Private keys are PKCS#1/PKCS#8 PEMs; convert literal `\n` to newlines so
    // they can live on a single line in .env files.
    privateKey: env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g, "\n"),
  });
  return cached;
}

export type GithubAccount = {
  login: string;
  id: number;
  type: "User" | "Organization";
  avatarUrl: string;
};

/** Look up the account that owns a given installation. */
export async function getInstallationAccount(
  installationId: number,
): Promise<GithubAccount> {
  const app = githubApp();
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

/** List repos the installation has access to. Paginates internally. */
export async function listInstallationRepos(
  installationId: number,
): Promise<GithubRepo[]> {
  const app = githubApp();
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
    if (page > 50) break; // sanity bound
  }
  return repos;
}

export type GithubBranch = {
  name: string;
  sha: string;
  protected: boolean;
};

/** List branches for a repo accessible to the installation. */
export async function listRepoBranches(
  installationId: number,
  owner: string,
  repo: string,
): Promise<GithubBranch[]> {
  const app = githubApp();
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

/** URL the user is sent to in order to install the App against a team. */
export function installUrl(state: string): string {
  if (!env.GITHUB_APP_SLUG) {
    throw new Error("GITHUB_APP_SLUG is not set");
  }
  const u = new URL(`https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`);
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
  return verifyWebhookSignatureWith(
    env.GITHUB_WEBHOOK_SECRET ?? "",
    payload,
    signature,
  );
}
