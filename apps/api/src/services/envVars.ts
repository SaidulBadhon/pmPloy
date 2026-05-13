import { Types } from "mongoose";
import { EnvVar } from "../models/EnvVar.ts";
import { open, isEncryptionConfigured } from "./crypto.ts";

/**
 * Decrypt and return all env vars for an app as a flat key/value object.
 * Returns an empty object if encryption isn't configured (the docs would be
 * un-decryptable in that case anyway).
 */
export async function getDecryptedEnv(appId: string): Promise<Record<string, string>> {
  if (!isEncryptionConfigured()) return {};
  const vars = await EnvVar.find({ appId: new Types.ObjectId(appId) }).lean();
  const out: Record<string, string> = {};
  for (const v of vars) {
    try {
      out[v.key] = open({
        ciphertext: v.ciphertext,
        iv: v.iv,
        authTag: v.authTag,
      });
    } catch (err) {
      console.error(`[env] failed to decrypt ${v.key} for app ${appId}:`, err);
    }
  }
  return out;
}
