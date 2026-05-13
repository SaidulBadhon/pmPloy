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
