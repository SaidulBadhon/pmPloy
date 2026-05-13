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
