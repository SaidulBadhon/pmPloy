import { Types } from "mongoose";
import { EnvVar } from "../models/EnvVar.ts";
import { open, isEncryptionConfigured } from "./crypto.ts";

/**
 * Decrypt env vars for an app+service. Layers shared (serviceName: "")
 * underneath any service-specific overrides for `serviceName`. Returns an
 * empty object if encryption isn't configured.
 */
export async function getDecryptedEnv(
  appId: string,
  serviceName: string,
): Promise<Record<string, string>> {
  if (!isEncryptionConfigured()) return {};
  const rows = await EnvVar.find({
    appId: new Types.ObjectId(appId),
    serviceName: { $in: ["", serviceName] },
  }).lean();

  const shared: Record<string, string> = {};
  const override: Record<string, string> = {};
  for (const v of rows) {
    const bucket = v.serviceName === "" ? shared : override;
    try {
      bucket[v.key] = open({
        ciphertext: v.ciphertext,
        iv: v.iv,
        authTag: v.authTag,
      });
    } catch (err) {
      console.error(
        `[env] failed to decrypt ${v.key} for app ${appId} service "${v.serviceName}":`,
        err,
      );
    }
  }
  return { ...shared, ...override };
}
