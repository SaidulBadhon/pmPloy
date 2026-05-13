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
    const broken = token.slice(0, -2) + "xx";
    expect(await readToken(broken)).toBeNull();
  });
});
