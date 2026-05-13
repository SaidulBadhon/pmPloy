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
    expect(
      await verifyWebhookSignatureWith(secret, payload + "x", sig),
    ).toBe(false);
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
  it("returns false when env vars are unset (default test env)", () => {
    // env.ts reads at import time; in tests we haven't set GITHUB_APP_ID etc.
    expect(isGithubConfigured()).toBe(false);
  });
});
