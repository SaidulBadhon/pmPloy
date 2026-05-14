import { describe, it, expect, beforeEach, beforeAll, afterAll } from "bun:test";
import mongoose, { Types } from "mongoose";
import { EnvVar } from "../models/EnvVar.ts";
import { seal, isEncryptionConfigured } from "./crypto.ts";
import { getDecryptedEnv } from "./envVars.ts";

describe("getDecryptedEnv merge order", () => {
  const appId = new Types.ObjectId();
  const teamId = new Types.ObjectId();

  beforeAll(() => {
    if (!isEncryptionConfigured()) {
      throw new Error(
        "ENV_ENCRYPTION_KEY not set — these tests rely on .env.test (auto-loaded by Bun when NODE_ENV=test). Run `bun test` from apps/api, not a parent dir.",
      );
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/pmploy-test-envvars");
    }
    await EnvVar.deleteMany({ appId });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await EnvVar.deleteMany({ appId });
      await mongoose.disconnect();
    }
  });

  async function put(serviceName: string, key: string, value: string) {
    const sealed = seal(value);
    await EnvVar.create({
      teamId,
      appId,
      serviceName,
      key,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      authTag: sealed.authTag,
    });
  }

  it("returns empty object when no rows exist", async () => {
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env).toEqual({});
  });

  it("returns shared values when no service overrides exist", async () => {
    await put("", "DATABASE_URL", "postgres://shared");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.DATABASE_URL).toBe("postgres://shared");
  });

  it("service override wins over shared for same key", async () => {
    await put("", "DATABASE_URL", "postgres://shared");
    await put("api", "DATABASE_URL", "postgres://api");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.DATABASE_URL).toBe("postgres://api");
  });

  it("other-service overrides do not leak", async () => {
    await put("worker", "WORKER_ONLY", "yes");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env.WORKER_ONLY).toBeUndefined();
  });

  it("merges shared + service-specific keys", async () => {
    await put("", "SHARED", "s");
    await put("api", "API_ONLY", "a");
    const env = await getDecryptedEnv(String(appId), "api");
    expect(env).toEqual({ SHARED: "s", API_ONLY: "a" });
  });
});
