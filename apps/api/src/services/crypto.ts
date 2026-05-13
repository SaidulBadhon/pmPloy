import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { env } from "../env.ts";

export class EncryptionNotConfiguredError extends Error {
  constructor() {
    super(
      "ENV_ENCRYPTION_KEY must be a 32-byte base64 value. Generate one with: `openssl rand -base64 32`",
    );
  }
}

export type Sealed = {
  ciphertext: string; // base64
  iv: string; // base64 (12 bytes)
  authTag: string; // base64 (16 bytes)
};

function key(): Buffer {
  if (!env.ENV_ENCRYPTION_KEY) throw new EncryptionNotConfiguredError();
  const buf = Buffer.from(env.ENV_ENCRYPTION_KEY, "base64");
  if (buf.length !== 32) throw new EncryptionNotConfiguredError();
  return buf;
}

export function isEncryptionConfigured(): boolean {
  if (!env.ENV_ENCRYPTION_KEY) return false;
  try {
    return Buffer.from(env.ENV_ENCRYPTION_KEY, "base64").length === 32;
  } catch {
    return false;
  }
}

/** Seal a plaintext string using AES-256-GCM. */
export function seal(plaintext: string): Sealed {
  return sealWith(key(), plaintext);
}

export function open(sealed: Sealed): string {
  return openWith(key(), sealed);
}

/** Pure variant for tests. */
export function sealWith(k: Buffer, plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

export function openWith(k: Buffer, sealed: Sealed): string {
  const iv = Buffer.from(sealed.iv, "base64");
  const tag = Buffer.from(sealed.authTag, "base64");
  const ct = Buffer.from(sealed.ciphertext, "base64");
  const decipher = createDecipheriv("aes-256-gcm", k, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
