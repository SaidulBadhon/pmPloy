# GitHub App Manifest Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a platform admin register a GitHub App from the UI via GitHub's [App Manifest flow](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest), persist the resulting credentials (encrypted) in MongoDB, and have all existing GitHub-using code transparently read from the database instead of `.env`. This removes the operator-must-edit-`.env`-and-restart step.

**Architecture:**
- New `GithubAppConfig` Mongoose model: a singleton document holding `appId`, `slug`, `clientId`, and sealed (AES-256-GCM) `privateKeyPem`, `webhookSecret`, `clientSecret`.
- New `services/githubAppConfig.ts`: get/set/clear with in-memory caching and `services/crypto.ts` for sealing.
- Refactor `services/github.ts` to read from `githubAppConfig` first, fall back to env vars (so existing installs don't break). All exported helpers that consumed env directly (`isGithubConfigured`, `githubApp`, `installUrl`, `verifyWebhookSignature`) become async.
- New routes under `/platform/github` (platform-admin-gated): `GET` for status, `POST /manifest` to mint a signed state + return manifest JSON, `GET /manifest/callback` to exchange GitHub's `code` for credentials, `DELETE` to disconnect.
- New web page `/settings/platform/github` with a "Register GitHub App" button that builds and submits the manifest form to `https://github.com/settings/apps/new`.

**Tech Stack:** Bun + Hono + Mongoose + Zod on the API, React + react-router-dom + Tailwind on the web. Manifest exchange uses plain `fetch` against `POST https://api.github.com/app-manifests/{code}/conversions` (Octokit has no helper).

---

## File Structure

**Create:**
- `apps/api/src/models/GithubAppConfig.ts` — singleton model, sealed secret fields.
- `apps/api/src/services/githubAppConfig.ts` — get/set/clear + cache.
- `apps/api/src/services/githubAppConfig.test.ts` — round-trip + cache invalidation.
- `apps/api/src/routes/platformGithub.ts` — manifest routes.
- `apps/api/src/lib/manifestState.ts` — sign/verify short-lived state tokens (HMAC over `JWT_SECRET`).
- `apps/api/src/lib/manifestState.test.ts` — happy-path + tamper/expiry rejection.
- `apps/web/src/pages/PlatformGithubPage.tsx` — UI.

**Modify:**
- `apps/api/src/services/github.ts` — async, DB-first with env fallback.
- `apps/api/src/services/github.test.ts` — update to async.
- `apps/api/src/routes/github.ts` — await new async helpers.
- `apps/api/src/routes/githubCallback.ts` — await.
- `apps/api/src/routes/webhooks.ts` — await signature verify.
- `apps/api/src/index.ts` — register `platformGithub` router.
- `apps/api/src/env.ts` — add `PUBLIC_ORIGIN` (optional, used to build manifest URLs when request host is unreliable behind proxies).
- `apps/web/src/App.tsx` — add `/settings/platform/github` route.
- `apps/web/src/pages/GithubSettingsPage.tsx` — replace env-var hint with link to platform page.
- `apps/web/src/components/AppShell.tsx` (if it has nav items) — add Platform → GitHub link (verify existence in Task 9 before editing).
- `packages/shared/src/schemas.ts` — new types: `GithubAppStatus`, `RegisterManifestResponse`.

---

## Task 1: Shared schema additions

**Files:**
- Modify: `packages/shared/src/schemas.ts` (append after line 220)

- [ ] **Step 1: Append new schemas**

Add to the end of `packages/shared/src/schemas.ts`:

```typescript
// --- GitHub App (platform-level) ---

export const GithubAppStatusSchema = z.object({
  configured: z.boolean(),
  appId: z.string().nullable(),
  slug: z.string().nullable(),
  htmlUrl: z.string().nullable(),
  source: z.enum(["database", "environment", "none"]),
});
export type GithubAppStatus = z.infer<typeof GithubAppStatusSchema>;

export const RegisterManifestResponseSchema = z.object({
  action: z.string().url(),       // where the form should POST (github.com/settings/apps/new)
  state: z.string(),              // signed state token (goes in the URL query)
  manifest: z.string(),           // JSON-stringified manifest, posted as a form field
});
export type RegisterManifestResponse = z.infer<typeof RegisterManifestResponseSchema>;
```

- [ ] **Step 2: Type-check shared**

Run: `bun --filter @pmploy/shared run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/schemas.ts
git commit -m "shared: add GithubAppStatus + RegisterManifestResponse schemas"
```

---

## Task 2: GithubAppConfig model

**Files:**
- Create: `apps/api/src/models/GithubAppConfig.ts`

- [ ] **Step 1: Create the model**

Create `apps/api/src/models/GithubAppConfig.ts`:

```typescript
import { Schema, model, Types, type InferSchemaType, type Model } from "mongoose";

const sealedSchema = new Schema(
  {
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
  },
  { _id: false },
);

const githubAppConfigSchema = new Schema(
  {
    // Singleton enforcement: this field is always "default".
    singleton: { type: String, required: true, unique: true, default: "default" },
    appId: { type: String, required: true },
    slug: { type: String, required: true },
    clientId: { type: String, required: true },
    htmlUrl: { type: String, default: "" },
    name: { type: String, default: "" },
    sealedPrivateKeyPem: { type: sealedSchema, required: true },
    sealedWebhookSecret: { type: sealedSchema, required: true },
    sealedClientSecret: { type: sealedSchema, required: true },
  },
  { timestamps: true },
);

export type GithubAppConfigDoc = InferSchemaType<typeof githubAppConfigSchema> & {
  _id: Types.ObjectId;
};
export const GithubAppConfig: Model<GithubAppConfigDoc> =
  model<GithubAppConfigDoc>("GithubAppConfig", githubAppConfigSchema);
```

- [ ] **Step 2: Type-check API**

Run: `bun --filter @pmploy/api run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/models/GithubAppConfig.ts
git commit -m "api: add GithubAppConfig model (singleton, sealed secrets)"
```

---

## Task 3: githubAppConfig service (get/set/clear + cache)

**Files:**
- Create: `apps/api/src/services/githubAppConfig.ts`
- Test: `apps/api/src/services/githubAppConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/services/githubAppConfig.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterEach } from "bun:test";
import { randomBytes } from "node:crypto";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { GithubAppConfig } from "../models/GithubAppConfig.ts";
import {
  getGithubAppConfig,
  setGithubAppConfig,
  clearGithubAppConfig,
  _resetGithubAppConfigCache,
} from "./githubAppConfig.ts";

let mongod: MongoMemoryServer;

beforeAll(async () => {
  process.env.ENV_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
});

afterEach(async () => {
  await GithubAppConfig.deleteMany({});
  _resetGithubAppConfigCache();
});

describe("githubAppConfig service", () => {
  it("returns null when no config is stored", async () => {
    expect(await getGithubAppConfig()).toBeNull();
  });

  it("seals + persists secrets and round-trips on read", async () => {
    await setGithubAppConfig({
      appId: "12345",
      slug: "pmploy-test",
      clientId: "Iv1.abc",
      clientSecret: "csecret",
      webhookSecret: "whsec",
      privateKeyPem: "-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----",
      htmlUrl: "https://github.com/apps/pmploy-test",
      name: "pmploy-test",
    });
    const cfg = await getGithubAppConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.appId).toBe("12345");
    expect(cfg!.webhookSecret).toBe("whsec");
    expect(cfg!.privateKeyPem).toContain("FAKE");

    // The raw doc must NOT contain the plaintext anywhere.
    const raw = await GithubAppConfig.findOne().lean();
    const serialised = JSON.stringify(raw);
    expect(serialised).not.toContain("whsec");
    expect(serialised).not.toContain("FAKE");
  });

  it("clears persisted config and cache", async () => {
    await setGithubAppConfig({
      appId: "12345", slug: "x", clientId: "Iv1.x", clientSecret: "x",
      webhookSecret: "x", privateKeyPem: "x", htmlUrl: "", name: "",
    });
    expect(await getGithubAppConfig()).not.toBeNull();
    await clearGithubAppConfig();
    expect(await getGithubAppConfig()).toBeNull();
  });

  it("invalidates the in-memory cache on set()", async () => {
    await setGithubAppConfig({
      appId: "1", slug: "a", clientId: "Iv1.a", clientSecret: "x",
      webhookSecret: "x", privateKeyPem: "x", htmlUrl: "", name: "",
    });
    const first = await getGithubAppConfig();
    expect(first!.appId).toBe("1");
    await setGithubAppConfig({
      appId: "2", slug: "b", clientId: "Iv1.b", clientSecret: "x",
      webhookSecret: "x", privateKeyPem: "x", htmlUrl: "", name: "",
    });
    const second = await getGithubAppConfig();
    expect(second!.appId).toBe("2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @pmploy/api test githubAppConfig`
Expected: FAIL — module `./githubAppConfig.ts` does not exist.

- [ ] **Step 3: Implement the service**

Create `apps/api/src/services/githubAppConfig.ts`:

```typescript
import { GithubAppConfig, type GithubAppConfigDoc } from "../models/GithubAppConfig.ts";
import { seal, open } from "./crypto.ts";

export type GithubAppConfigInput = {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
  htmlUrl: string;
  name: string;
};

export type GithubAppConfigOpened = {
  appId: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  webhookSecret: string;
  privateKeyPem: string;
  htmlUrl: string;
  name: string;
};

let cache: GithubAppConfigOpened | null | undefined;

export function _resetGithubAppConfigCache(): void {
  cache = undefined;
}

export async function getGithubAppConfig(): Promise<GithubAppConfigOpened | null> {
  if (cache !== undefined) return cache;
  const doc = await GithubAppConfig.findOne({ singleton: "default" }).lean<GithubAppConfigDoc>();
  if (!doc) {
    cache = null;
    return null;
  }
  try {
    cache = {
      appId: doc.appId,
      slug: doc.slug,
      clientId: doc.clientId,
      htmlUrl: doc.htmlUrl ?? "",
      name: doc.name ?? "",
      clientSecret: open(doc.sealedClientSecret),
      webhookSecret: open(doc.sealedWebhookSecret),
      privateKeyPem: open(doc.sealedPrivateKeyPem),
    };
    return cache;
  } catch (err) {
    console.error("[githubAppConfig] failed to decrypt:", err);
    cache = null;
    return null;
  }
}

export async function setGithubAppConfig(input: GithubAppConfigInput): Promise<void> {
  await GithubAppConfig.findOneAndUpdate(
    { singleton: "default" },
    {
      singleton: "default",
      appId: input.appId,
      slug: input.slug,
      clientId: input.clientId,
      htmlUrl: input.htmlUrl,
      name: input.name,
      sealedPrivateKeyPem: seal(input.privateKeyPem),
      sealedWebhookSecret: seal(input.webhookSecret),
      sealedClientSecret: seal(input.clientSecret),
    },
    { upsert: true, new: true },
  );
  _resetGithubAppConfigCache();
}

export async function clearGithubAppConfig(): Promise<void> {
  await GithubAppConfig.deleteOne({ singleton: "default" });
  _resetGithubAppConfigCache();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @pmploy/api test githubAppConfig`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/githubAppConfig.ts apps/api/src/services/githubAppConfig.test.ts
git commit -m "api: add githubAppConfig service with sealed secret storage"
```

---

## Task 4: Manifest state-token helper (signed, expiring)

**Files:**
- Create: `apps/api/src/lib/manifestState.ts`
- Test: `apps/api/src/lib/manifestState.test.ts`

The manifest flow uses a `state` URL param that round-trips through GitHub. We sign it with `JWT_SECRET` so the callback can verify it's ours, bound to the initiating admin's user id, and expires in 10 minutes.

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/lib/manifestState.test.ts`:

```typescript
import { describe, it, expect } from "bun:test";
import { signManifestState, verifyManifestState } from "./manifestState.ts";

const SECRET = "test-secret-min-16-chars-please";

describe("manifestState", () => {
  it("round-trips a userId", async () => {
    const token = await signManifestState(SECRET, "user-123");
    const result = await verifyManifestState(SECRET, token);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-123");
  });

  it("rejects a tampered token", async () => {
    const token = await signManifestState(SECRET, "user-123");
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifyManifestState(SECRET, tampered)).toBeNull();
  });

  it("rejects an expired token", async () => {
    // 11 minutes in the past.
    const token = await signManifestState(SECRET, "user-123", Date.now() - 11 * 60 * 1000);
    expect(await verifyManifestState(SECRET, token)).toBeNull();
  });

  it("rejects when signed with a different secret", async () => {
    const token = await signManifestState(SECRET, "user-123");
    expect(await verifyManifestState("other-secret-min-16-chars", token)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @pmploy/api test manifestState`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/api/src/lib/manifestState.ts`:

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 10 * 60 * 1000; // 10 minutes

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function b64urlDecode(s: string): Buffer {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

export async function signManifestState(
  secret: string,
  userId: string,
  issuedAt: number = Date.now(),
): Promise<string> {
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, t: issuedAt })));
  const sig = b64url(createHmac("sha256", secret).update(payload).digest());
  return `${payload}.${sig}`;
}

export async function verifyManifestState(
  secret: string,
  token: string,
): Promise<{ userId: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, sig] = parts;
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const provided = b64urlDecode(sig);
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return null;
  }
  try {
    const data = JSON.parse(b64urlDecode(payload).toString("utf8"));
    if (typeof data.u !== "string" || typeof data.t !== "number") return null;
    if (Date.now() - data.t > TTL_MS) return null;
    return { userId: data.u };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @pmploy/api test manifestState`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/lib/manifestState.ts apps/api/src/lib/manifestState.test.ts
git commit -m "api: add manifestState — signed, 10-min state tokens for GitHub manifest flow"
```

---

## Task 5: Refactor `services/github.ts` to async, DB-first, env fallback

**Files:**
- Modify: `apps/api/src/services/github.ts`
- Modify: `apps/api/src/services/github.test.ts`

`isGithubConfigured`, `githubApp`, `installUrl`, `verifyWebhookSignature` all need to become async and prefer the DB config. The existing module-level `cached: App | null` must be invalidated when config changes — we'll key the cache on `appId+privateKey` hash so a config swap re-creates it lazily.

- [ ] **Step 1: Update the test to expect async signatures**

Replace `apps/api/src/services/github.test.ts` with:

```typescript
import { describe, it, expect } from "bun:test";
import { sign } from "@octokit/webhooks-methods";
import {
  verifyWebhookSignatureWith,
  isGithubConfigured,
} from "./github.ts";

describe("verifyWebhookSignatureWith", () => {
  const secret = "shhh";
  const payload = JSON.stringify({ action: "push", repository: { id: 1 } });

  it("accepts a correctly signed payload", async () => {
    const sig = await sign(secret, payload);
    expect(await verifyWebhookSignatureWith(secret, payload, sig)).toBe(true);
  });

  it("rejects a tampered payload", async () => {
    const sig = await sign(secret, payload);
    expect(await verifyWebhookSignatureWith(secret, payload + "x", sig)).toBe(false);
  });

  it("rejects when secret missing", async () => {
    const sig = await sign(secret, payload);
    expect(await verifyWebhookSignatureWith("", payload, sig)).toBe(false);
  });

  it("rejects when signature missing", async () => {
    expect(await verifyWebhookSignatureWith(secret, payload, null)).toBe(false);
  });
});

describe("isGithubConfigured", () => {
  it("returns false when neither DB nor env has config (default test env)", async () => {
    expect(await isGithubConfigured()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --filter @pmploy/api test services/github`
Expected: FAIL — `isGithubConfigured()` currently returns a boolean, not a Promise; the `await` will pass through but the type changes will break the build in later tasks.

- [ ] **Step 3: Refactor `services/github.ts`**

Replace `apps/api/src/services/github.ts` with:

```typescript
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

export async function verifyWebhookSignatureWith(
  secret: string,
  payload: string,
  signature: string | null | undefined,
): Promise<boolean> {
  if (!secret || !signature) return false;
  return verify(secret, payload, signature);
}

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --filter @pmploy/api test services/github`
Expected: all 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/github.ts apps/api/src/services/github.test.ts
git commit -m "api: make services/github.ts async, prefer DB config over env"
```

---

## Task 6: Add `await` to API routes that consumed the now-async helpers

**Files:**
- Modify: `apps/api/src/routes/github.ts`
- Modify: `apps/api/src/routes/githubCallback.ts`
- Modify: `apps/api/src/routes/webhooks.ts`

- [ ] **Step 1: Update `routes/github.ts`**

Replace every call to `isGithubConfigured()` with `await isGithubConfigured()` and `installUrl(x)` with `await installUrl(x)`. The handlers are already async. Specifically:

In `apps/api/src/routes/github.ts`:
- Line ~36: `c.json({ configured: isGithubConfigured() })` → `c.json({ configured: await isGithubConfigured() })` (and make the handler async).
- Line ~41: `if (!isGithubConfigured())` → `if (!(await isGithubConfigured()))` (and make handler async).
- Line ~45: `const url = installUrl(...)` → `const url = await installUrl(...)`.
- Line ~75: `if (!isGithubConfigured())` → `if (!(await isGithubConfigured()))`.

- [ ] **Step 2: Update `routes/githubCallback.ts`**

In `apps/api/src/routes/githubCallback.ts` line ~23: `if (!isGithubConfigured())` → `if (!(await isGithubConfigured()))`.

- [ ] **Step 3: Update `routes/webhooks.ts`**

`verifyWebhookSignature` is already awaited (line 18). Verify no other changes needed. (`await verifyWebhookSignature(raw, signature)` should still type-check.)

- [ ] **Step 4: Type-check**

Run: `bun --filter @pmploy/api run typecheck`
Expected: no errors.

- [ ] **Step 5: Run all API tests**

Run: `bun --filter @pmploy/api test`
Expected: existing suites pass.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/github.ts apps/api/src/routes/githubCallback.ts apps/api/src/routes/webhooks.ts
git commit -m "api: await async github helpers in routes"
```

---

## Task 7: Add `PUBLIC_ORIGIN` env var

**Files:**
- Modify: `apps/api/src/env.ts`

The manifest must contain absolute URLs (`hook_attributes.url`, `redirect_url`, `setup_url`, `callback_urls`). We need to know the public origin (`https://pmploy.example.com`). We let the operator set it explicitly; if unset we'll derive it from the request in the route.

- [ ] **Step 1: Add the field**

In `apps/api/src/env.ts`, inside the schema object (after line 13, before `GITHUB_APP_ID`):

```typescript
  PUBLIC_ORIGIN: z.string().default(""),
```

- [ ] **Step 2: Type-check**

Run: `bun --filter @pmploy/api run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/env.ts
git commit -m "api: add optional PUBLIC_ORIGIN env (used to build manifest URLs)"
```

---

## Task 8: Manifest routes (`/platform/github/*`)

**Files:**
- Create: `apps/api/src/routes/platformGithub.ts`
- Modify: `apps/api/src/index.ts`

- [ ] **Step 1: Create the router**

Create `apps/api/src/routes/platformGithub.ts`:

```typescript
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
```

- [ ] **Step 2: Register the router**

In `apps/api/src/index.ts`, add the import alongside the other route imports (e.g. after `platformRoutes`):

```typescript
import platformGithubRoutes from "./routes/platformGithub.ts";
```

And mount it (after `app.route("/", platformRoutes);`):

```typescript
app.route("/", platformGithubRoutes);
```

- [ ] **Step 3: Type-check**

Run: `bun --filter @pmploy/api run typecheck`
Expected: no errors.

- [ ] **Step 4: Run API tests**

Run: `bun --filter @pmploy/api test`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/platformGithub.ts apps/api/src/index.ts
git commit -m "api: add /platform/github/* manifest flow endpoints"
```

---

## Task 9: Web page `/settings/platform/github`

**Files:**
- Create: `apps/web/src/pages/PlatformGithubPage.tsx`
- Modify: `apps/web/src/App.tsx`

- [ ] **Step 1: Create the page**

Create `apps/web/src/pages/PlatformGithubPage.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import type {
  GithubAppStatus,
  RegisterManifestResponse,
} from "@pmploy/shared";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

export default function PlatformGithubPage() {
  const [status, setStatus] = useState<GithubAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<GithubAppStatus>(`/platform/github`);
      setStatus(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only platform admins can manage the GitHub App.");
      } else {
        setError(err instanceof Error ? err.message : "load failed");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startRegister() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<RegisterManifestResponse>(`/platform/github/manifest`, {
        method: "POST",
      });
      submitManifestForm(r);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "register failed");
    }
  }

  async function disconnect() {
    if (!confirm("Disconnect the GitHub App? Teams will lose access to repos.")) return;
    setBusy(true);
    try {
      await api(`/platform/github`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Platform · GitHub</h1>
        <p className="text-neutral-400">
          Register a GitHub App for this pmPloy instance. Teams can then install
          it on their orgs to connect repos.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {status === null ? (
        <p className="text-neutral-500">Loading…</p>
      ) : status.configured ? (
        <Card>
          <CardTitle>GitHub App configured</CardTitle>
          <CardDescription className="mt-1">
            <strong>{status.slug}</strong> (id {status.appId}) ·
            source: <code>{status.source}</code>
            {status.htmlUrl && (
              <>
                {" · "}
                <a className="underline" href={status.htmlUrl} target="_blank" rel="noreferrer">
                  Open on GitHub
                </a>
              </>
            )}
          </CardDescription>
          {status.source === "database" && (
            <div className="mt-4">
              <Button variant="danger" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardTitle>No GitHub App registered</CardTitle>
          <CardDescription className="mt-1">
            Click below to register one. You'll be redirected to GitHub to confirm
            the app's permissions and webhook URL.
          </CardDescription>
          <div className="mt-4">
            <Button onClick={startRegister} disabled={busy}>
              {busy ? "Preparing…" : "Register GitHub App"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function submitManifestForm(r: RegisterManifestResponse) {
  const form = document.createElement("form");
  form.method = "POST";
  // GitHub requires the state in the URL query, not the form body.
  const url = new URL(r.action);
  url.searchParams.set("state", r.state);
  form.action = url.toString();

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = r.manifest;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}
```

- [ ] **Step 2: Wire the route**

In `apps/web/src/App.tsx`, add the import alongside `PlatformPage`:

```typescript
import PlatformGithubPage from "./pages/PlatformGithubPage";
```

And add the route inside the authed `<Route element={<AppShell />}>` group (alongside `settings/platform`):

```tsx
<Route path="settings/platform/github" element={<PlatformGithubPage />} />
```

- [ ] **Step 3: Type-check + build**

Run: `bun --filter @pmploy/web run typecheck && bun --filter @pmploy/web run build`
Expected: no errors, `dist/` regenerated.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/pages/PlatformGithubPage.tsx apps/web/src/App.tsx
git commit -m "web: add /settings/platform/github page for manifest registration"
```

---

## Task 10: Update existing `GithubSettingsPage` copy

The old "set GITHUB_APP_ID in .env" hint is now wrong. Replace with a pointer to the platform page.

**Files:**
- Modify: `apps/web/src/pages/GithubSettingsPage.tsx` (lines 107-116)

- [ ] **Step 1: Update the "not configured" card**

In `apps/web/src/pages/GithubSettingsPage.tsx`, replace the block at lines 107-116:

```tsx
      {configured === false && (
        <Card>
          <CardTitle>GitHub App not configured</CardTitle>
          <CardDescription className="mt-1">
            A platform admin must register a GitHub App for this pmPloy instance
            before teams can connect repos. See{" "}
            <a className="underline" href="/settings/platform/github">
              Platform · GitHub
            </a>.
          </CardDescription>
        </Card>
      )}
```

- [ ] **Step 2: Build to verify**

Run: `bun --filter @pmploy/web run build`
Expected: builds cleanly.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/pages/GithubSettingsPage.tsx
git commit -m "web: replace env-var hint on GithubSettingsPage with link to platform page"
```

---

## Task 11: Add navigation entry (if `AppShell` has a nav)

**Files:**
- Inspect: `apps/web/src/components/AppShell.tsx`

- [ ] **Step 1: Inspect**

Run: `grep -n 'settings/platform\|GitHub\|Platform' apps/web/src/components/AppShell.tsx`

If there's a nav that lists settings links, add a sibling entry pointing to `/settings/platform/github`, gated on `isPlatformAdmin`. If `AppShell` has no nav for these (users navigate by URL), skip and note it in the commit message.

- [ ] **Step 2: Edit if applicable**

(Code shown only if the nav exists — exact edit depends on the file structure. Pattern:)

```tsx
{isPlatformAdmin && (
  <NavLink to="/settings/platform/github">GitHub App</NavLink>
)}
```

- [ ] **Step 3: Build**

Run: `bun --filter @pmploy/web run build`
Expected: builds cleanly.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/AppShell.tsx
git commit -m "web: link to Platform · GitHub from app shell nav (admins only)"
```

(Skip the commit if no nav edit was needed.)

---

## Task 12: End-to-end manual smoke test

The manifest exchange requires a real GitHub round-trip, so this step is manual.

- [ ] **Step 1: Deploy to the test VM**

```bash
ssh root@34.39.231.100
cd /home/pmploy/pmPloy
su - pmploy -c 'cd ~/pmPloy && git pull && bun install && cd apps/web && bun run build'
systemctl restart pmploy-api
```

- [ ] **Step 2: Set `PUBLIC_ORIGIN` (so the manifest has correct URLs)**

For testing over plain HTTP/IP, add to `/home/pmploy/pmPloy/.env`:

```
PUBLIC_ORIGIN=http://34.39.231.100
```

Then `systemctl restart pmploy-api`.

Note: GitHub requires HTTPS for production manifest URLs. Plain HTTP works for `localhost` only, and may be rejected. **For the real smoke test, switch to HTTPS with a domain first** (see PRODUCTION.md / earlier deploy notes).

- [ ] **Step 3: Walk the flow in the browser**

1. Log in as the platform admin (first user).
2. Visit `/settings/platform/github`. Expect "No GitHub App registered".
3. Click **Register GitHub App**. Browser POSTs to `github.com/settings/apps/new`.
4. Review the pre-filled app on GitHub, click **Create GitHub App for [user]**.
5. GitHub redirects back to `/api/platform/github/manifest/callback?code=...&state=...`.
6. Server exchanges + persists. Browser lands on `/settings/platform/github?registered=1` showing the new app.
7. Open Mongo: `mongosh pmploy` → `db.githubappconfigs.findOne()` — confirm `sealed*` fields contain non-empty `ciphertext`/`iv`/`authTag` and **no plaintext PEM/secret**.

- [ ] **Step 4: Install on an org and connect a repo**

1. From the app's GitHub page, click **Install App**. Pick a user/org. Grant access to a repo.
2. Land back on pmPloy. The team's `/settings/github` should now list the installation.
3. Create a new app pointing at the repo. Confirm the deploy fires on push.

- [ ] **Step 5: Tear-down test**

On `/settings/platform/github`, click **Disconnect**. Confirm Mongo doc is gone:

```bash
mongosh pmploy --eval 'db.githubappconfigs.findOne()'
# → null
```

---

## Self-Review

Reviewed against the spec discussed in conversation. Coverage:

- ✅ In-product registration via manifest flow: Tasks 4, 8, 9.
- ✅ Encrypted-at-rest storage of PEM, webhook secret, client secret: Tasks 2, 3.
- ✅ All existing code reads from DB transparently with env fallback: Task 5.
- ✅ Platform-admin gating on register/delete: Task 8 uses `requirePlatformAdmin`.
- ✅ CSRF protection on the callback: Task 4 + Task 8 (`verifyManifestState` + `userId` match).
- ✅ Updated UI copy on team-level page: Task 10.
- ✅ Manual smoke-test plan documented: Task 12.

Type consistency: `GithubAppStatus.source` is `"database" | "environment" | "none"` everywhere it's used. `RegisterManifestResponse` shape matches between server response and form-submit helper.

No placeholders. Every code step contains the actual content.

One known limitation, called out for the user: GitHub's manifest flow rejects non-HTTPS `redirect_url`/`hook_attributes.url` outside of `localhost`. Task 12 step 2 notes this; the proper smoke test requires a domain + HTTPS (which the existing PRODUCTION.md flow already supports via Caddy auto-TLS).
