import { describe, it, expect } from "bun:test";
import { randomBytes } from "node:crypto";
import { sealWith, openWith } from "./crypto.ts";

describe("AES-256-GCM seal/open", () => {
  const key = randomBytes(32);

  it("round-trips an ASCII string", () => {
    const sealed = sealWith(key, "hello world");
    expect(openWith(key, sealed)).toBe("hello world");
  });

  it("round-trips unicode and long inputs", () => {
    const text = "🎉 " + "x".repeat(1000) + " — café";
    const sealed = sealWith(key, text);
    expect(openWith(key, sealed)).toBe(text);
  });

  it("produces a different ciphertext for the same input (random IV)", () => {
    const a = sealWith(key, "same");
    const b = sealWith(key, "same");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
  });

  it("rejects a tampered ciphertext", () => {
    const sealed = sealWith(key, "secret");
    const bytes = Buffer.from(sealed.ciphertext, "base64");
    bytes[0] = (bytes[0] ?? 0) ^ 1;
    const tampered = { ...sealed, ciphertext: bytes.toString("base64") };
    expect(() => openWith(key, tampered)).toThrow();
  });

  it("rejects opening with the wrong key", () => {
    const otherKey = randomBytes(32);
    const sealed = sealWith(key, "secret");
    expect(() => openWith(otherKey, sealed)).toThrow();
  });
});
