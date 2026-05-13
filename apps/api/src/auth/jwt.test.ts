import { describe, it, expect } from "bun:test";
import { issueToken, readToken } from "./jwt.ts";

describe("jwt", () => {
  it("issues a token that round-trips through readToken", async () => {
    const token = await issueToken({ id: "abc123", email: "a@b.com" });
    const payload = await readToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe("abc123");
    expect(payload?.email).toBe("a@b.com");
    expect(payload?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("returns null for a tampered token", async () => {
    const token = await issueToken({ id: "abc", email: "a@b.com" });
    // Flip a character in the payload so the signature can no longer verify.
    const parts = token.split(".");
    const mid = parts[1]!;
    const flipped = (mid[0] === "A" ? "B" : "A") + mid.slice(1);
    const broken = `${parts[0]}.${flipped}.${parts[2]}`;
    expect(await readToken(broken)).toBeNull();
  });
});
