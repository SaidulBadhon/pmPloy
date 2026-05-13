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
