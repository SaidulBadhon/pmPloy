import { describe, it, expect, mock } from "bun:test";
import { sign } from "@octokit/webhooks-methods";

// Mock the githubAppConfig module before importing github.ts so that
// getGithubAppConfig() returns null without attempting a MongoDB connection.
mock.module("./githubAppConfig.ts", () => ({
  getGithubAppConfig: async () => null,
  _resetGithubAppConfigCache: () => {},
}));

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
