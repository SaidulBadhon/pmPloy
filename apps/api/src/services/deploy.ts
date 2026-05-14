import { existsSync } from "node:fs";
import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { Types, type HydratedDocument } from "mongoose";
import { Application, type ApplicationDoc } from "../models/Application.ts";
import {
  Deployment,
  DEPLOYMENT_LOG_LIMIT,
  type DeploymentDoc,
} from "../models/Deployment.ts";

type AppDoc = HydratedDocument<ApplicationDoc>;
type DepDoc = HydratedDocument<DeploymentDoc>;
import { env } from "../env.ts";
import {
  pm2NameForApp,
  startProcess,
  describeProcess,
  deleteProcess,
} from "./pm2.ts";
import { runShell, runStreaming } from "./spawn.ts";
import { getHeadCommit, getInstallationToken } from "./github.ts";
import { deployBus, deployTopic } from "./pubsub.ts";
import { caddy } from "./caddy.ts";
import { Domain } from "../models/Domain.ts";
import { getDecryptedEnv } from "./envVars.ts";
import { recordAudit } from "./audit.ts";
import { findEcosystemFile, parseEcosystem } from "./ecosystem.ts";
import { reconcileServices } from "./appServices.ts";

const KEEP_DEPLOYMENTS = 3;

// Serialise deploys per app so two pushes in quick succession don't race.
const queues = new Map<string, Promise<void>>();

export type EnqueueArgs = {
  appId: string;
  triggeredBy: "webhook" | "manual" | "user";
  triggeredByUserId?: string;
  branch?: string;
  commitSha?: string;
};

export async function enqueueDeploy(args: EnqueueArgs): Promise<DeploymentDoc> {
  const app = await Application.findById(args.appId);
  if (!app) throw new Error("application not found");

  const dep = await Deployment.create({
    appId: app._id,
    teamId: app.teamId,
    triggeredBy: args.triggeredBy,
    triggeredByUserId: args.triggeredByUserId
      ? new Types.ObjectId(args.triggeredByUserId)
      : undefined,
    branch: args.branch ?? app.github?.branch ?? "",
    commitSha: args.commitSha ?? "",
    status: "queued",
  });

  const previous = queues.get(args.appId) ?? Promise.resolve();
  const next = previous.then(() => runDeploy(String(dep._id)).catch((err) => {
    console.error(`[deploy] uncaught error for ${dep._id}:`, err);
  }));
  queues.set(args.appId, next);

  return dep;
}

async function runDeploy(deploymentId: string): Promise<void> {
  const dep = await Deployment.findById(deploymentId);
  if (!dep) return;
  const app = await Application.findById(dep.appId);
  if (!app) {
    await fail(dep, "application no longer exists");
    return;
  }

  const ctx = newContext(dep);
  try {
    dep.status = "building";
    dep.startedAt = new Date();
    await dep.save();
    publishStatus(deploymentId, "building");

    await ctx.log(`▶ starting deploy (${dep.triggeredBy})`);

    if (app.sourceType === "github") {
      await deployFromGithub(app, dep, ctx);
    } else {
      await deployLocal(app, dep, ctx);
    }

    dep.status = "live";
    dep.finishedAt = new Date();
    await ctx.flush(true);
    await dep.save();
    publishStatus(deploymentId, "live");
    await ctx.log("✓ deploy complete");

    app.status = "running";
    await app.save();

    await recordAudit({
      teamId: String(app.teamId),
      userId: dep.triggeredByUserId ? String(dep.triggeredByUserId) : undefined,
      action: "deploy.live",
      target: { type: "app", id: String(app._id), label: app.name },
      meta: {
        deploymentId,
        commitSha: dep.commitSha,
        triggeredBy: dep.triggeredBy,
      },
    });

    // Best-effort: refresh Caddy routes (port may have changed) and prune.
    await resyncDomains(String(app._id), app.port ?? null, ctx).catch(() => undefined);
    await pruneOldDeployDirs(String(app._id)).catch(() => undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.log(`✗ ${message}`);
    await fail(dep, message);
    app.status = "errored";
    await app.save().catch(() => undefined);
    await recordAudit({
      teamId: String(app.teamId),
      userId: dep.triggeredByUserId ? String(dep.triggeredByUserId) : undefined,
      action: "deploy.failed",
      target: { type: "app", id: String(app._id), label: app.name },
      meta: { deploymentId, error: message },
    });
  } finally {
    deployBus.publish(deployTopic(deploymentId), { type: "done" });
  }
}

async function deployLocal(
  app: AppDoc,
  dep: DepDoc,
  ctx: LogContext,
): Promise<void> {
  if (!app.cwd) throw new Error("local app has no working directory configured");
  await ctx.log(`▶ launching app in ${app.cwd}`);
  await startServices(app, ctx);
  dep.workdir = app.cwd;
}

async function deployFromGithub(
  app: AppDoc,
  dep: DepDoc,
  ctx: LogContext,
): Promise<void> {
  const gh = app.github;
  if (!gh) throw new Error("application has no github source configured");
  const [owner, repo] = gh.repo.split("/");
  if (!owner || !repo) throw new Error(`invalid repo "${gh.repo}"`);

  const branch = dep.branch || gh.branch;

  await ctx.log(`▶ resolving HEAD of ${gh.repo}@${branch}`);
  const head = dep.commitSha
    ? { sha: dep.commitSha, message: "", author: "" }
    : await getHeadCommit(gh.installationId, owner, repo, branch);
  dep.commitSha = head.sha;
  dep.commitMessage = head.message;
  await dep.save();

  const token = await getInstallationToken(gh.installationId);
  const workdir = path.resolve(
    env.PMPLOY_DATA_DIR,
    "apps",
    String(app._id),
    String(dep._id),
  );
  await mkdir(workdir, { recursive: true });
  dep.workdir = workdir;
  await dep.save();

  const cloneUrl = `https://x-access-token:${token}@github.com/${owner}/${repo}.git`;
  await ctx.log(`▶ cloning ${gh.repo}@${branch} (${head.sha.slice(0, 7)})`);
  const cloneCode = await runStreaming(
    [
      "git",
      "clone",
      "--depth",
      "1",
      "--branch",
      branch,
      cloneUrl,
      workdir,
    ],
    {
      onLine: (line) => {
        // Strip the token in case git ever echoes it.
        ctx.log(line.replace(token, "<token>")).catch(() => undefined);
      },
    },
  );
  if (cloneCode !== 0) throw new Error(`git clone exited with code ${cloneCode}`);

  // If the user pinned a specific sha, do a fast checkout.
  if (dep.commitSha && dep.commitSha !== head.sha) {
    await runStreaming(["git", "fetch", "--depth", "1", "origin", dep.commitSha], {
      cwd: workdir,
      onLine: (l) => ctx.log(l).catch(() => undefined),
    });
    await runStreaming(["git", "checkout", dep.commitSha], {
      cwd: workdir,
      onLine: (l) => ctx.log(l).catch(() => undefined),
    });
  }

  const buildDir = gh.rootDir
    ? path.resolve(workdir, gh.rootDir)
    : workdir;

  // Install + build
  const installCmd = detectInstallCommand(buildDir);
  await ctx.log(`▶ install: ${installCmd}`);
  const installCode = await runShell(installCmd, {
    cwd: buildDir,
    onLine: (l) => ctx.log(l).catch(() => undefined),
  });
  if (installCode !== 0) throw new Error(`install exited with code ${installCode}`);

  if (gh.buildCommand && gh.buildCommand.trim()) {
    await ctx.log(`▶ build: ${gh.buildCommand}`);
    const buildCode = await runShell(gh.buildCommand, {
      cwd: buildDir,
      onLine: (l) => ctx.log(l).catch(() => undefined),
    });
    if (buildCode !== 0) throw new Error(`build exited with code ${buildCode}`);
  }

  // Switch the live cwd to the new deployment dir before (re)starting PM2.
  app.cwd = buildDir;
  await app.save();

  await startServices(app, ctx);
}

async function startServices(app: AppDoc, ctx: LogContext): Promise<void> {
  const ecoPath = findEcosystemFile(app.cwd);
  if (ecoPath) {
    await ctx.log(`▶ detected ecosystem file: ${path.relative(app.cwd, ecoPath)}`);
    const parsed = await parseEcosystem(ecoPath);
    const existing = (app.services ?? []).map((s) => ({
      name: s.name,
      pm2Name: s.pm2Name,
      port: s.port ?? null,
      isPrimary: !!s.isPrimary,
    }));
    const { services, removed } = reconcileServices(String(app._id), existing, parsed.apps);

    // Backwards-compat: on the first deploy after this upgrade, the old
    // single-process name might still be alive.
    await deleteProcess(`pmploy:${String(app._id)}`).catch(() => undefined);

    const userEnv = await getDecryptedEnv(String(app._id));
    for (const svc of services) {
      const eco = parsed.apps.find((a) => a.name === svc.name);
      if (!eco) continue;
      await ctx.log(`▶ launching service ${svc.name} (${svc.pm2Name})`);
      const env: Record<string, string> = {
        ...userEnv,
        ...(eco.env ?? {}),
      };
      if (svc.port !== null) env.PORT = String(svc.port);
      const info = await startProcess({
        name: svc.pm2Name,
        cwd: eco.cwd ? path.resolve(app.cwd, eco.cwd) : app.cwd,
        script: eco.script,
        interpreter: eco.interpreter,
        args: eco.args,
        instances: eco.instances ?? 1,
        execMode: eco.execMode ?? "fork",
        env,
      });
      await ctx.log(`  pm2 status: ${info.status}, pid ${info.pid}`);
    }

    for (const gone of removed) {
      await ctx.log(`▶ tearing down removed service ${gone.name}`);
      await deleteProcess(gone.pm2Name).catch(() => undefined);
    }

    app.set("services", services);
    await app.save();

    // Health check: give PM2 a moment to settle, then confirm each service is online.
    await new Promise((r) => setTimeout(r, 250));
    for (const svc of services) {
      const after = await describeProcess(svc.pm2Name).catch(() => null);
      if (after && after.status !== "online") {
        throw new Error(`service ${svc.name} not online (status ${after.status})`);
      }
    }
    return;
  }

  // Single-process fallback. Materialized into a single "default" service so
  // the rest of the system can treat all apps uniformly.
  const defaultName = pm2NameForApp(String(app._id));
  // Tear down the legacy un-suffixed process if it still exists.
  await deleteProcess(`pmploy:${String(app._id)}`).catch(() => undefined);

  const userEnv = await getDecryptedEnv(String(app._id));
  await ctx.log(`▶ launching ${app.script} (${defaultName})`);
  const info = await startProcess({
    name: defaultName,
    cwd: app.cwd,
    script: app.script,
    interpreter: app.interpreter || undefined,
    instances: app.instances ?? 1,
    execMode: app.execMode,
    env: { ...userEnv, PORT: String(app.port ?? "") },
  });
  await ctx.log(`  pm2 status: ${info.status}, pid ${info.pid}`);

  // Tear down any prior multi-service processes that no longer apply.
  for (const gone of app.services ?? []) {
    if (gone.pm2Name === defaultName) continue;
    await deleteProcess(gone.pm2Name).catch(() => undefined);
  }

  app.set("services", [
    {
      name: "default",
      pm2Name: defaultName,
      port: app.port ?? null,
      isPrimary: true,
    },
  ]);
  await app.save();

  await new Promise((r) => setTimeout(r, 250));
  const after = await describeProcess(defaultName).catch(() => null);
  if (after && after.status !== "online") {
    throw new Error(`pm2 process not online (status ${after.status})`);
  }
}

function detectInstallCommand(dir: string): string {
  if (existsSync(path.join(dir, "bun.lockb")) || existsSync(path.join(dir, "bun.lock")))
    return "bun install --frozen-lockfile";
  if (existsSync(path.join(dir, "pnpm-lock.yaml")))
    return "pnpm install --frozen-lockfile";
  if (existsSync(path.join(dir, "yarn.lock")))
    return "yarn install --frozen-lockfile";
  if (existsSync(path.join(dir, "package-lock.json"))) return "npm ci";
  if (existsSync(path.join(dir, "package.json"))) return "npm install";
  return "true"; // no-op for non-Node projects
}

async function resyncDomains(
  appId: string,
  port: number | null,
  ctx: LogContext,
): Promise<void> {
  if (!port) return;
  const domains = await Domain.find({ appId: new Types.ObjectId(appId) });
  if (domains.length === 0) return;
  for (const d of domains) {
    try {
      await caddy.upsertDomain(d.host, port);
      d.sslStatus = "active";
      d.lastError = "";
      await d.save();
      await ctx.log(`▶ caddy: ${d.host} -> 127.0.0.1:${port}`);
    } catch (err) {
      d.sslStatus = "error";
      d.lastError = err instanceof Error ? err.message : String(err);
      await d.save();
      await ctx.log(`✗ caddy sync failed for ${d.host}: ${d.lastError}`);
    }
  }
}

async function pruneOldDeployDirs(appId: string): Promise<void> {
  const recent = await Deployment.find({ appId: new Types.ObjectId(appId) })
    .sort({ createdAt: -1 })
    .limit(KEEP_DEPLOYMENTS)
    .select("_id")
    .lean();
  const keep = new Set(recent.map((d) => String(d._id)));

  const appDir = path.resolve(env.PMPLOY_DATA_DIR, "apps", appId);
  if (!existsSync(appDir)) return;
  const entries = await readdir(appDir);
  await Promise.all(
    entries
      .filter((e) => !keep.has(e))
      .map((e) => rm(path.join(appDir, e), { recursive: true, force: true })),
  );
}

// --- log buffering helpers ---

type LogContext = {
  log: (line: string) => Promise<void>;
  flush: (force?: boolean) => Promise<void>;
};

function newContext(dep: DepDoc): LogContext {
  const id = String(dep._id);
  const topic = deployTopic(id);
  let pending: string[] = [];
  let lastFlushedAt = 0;

  async function flushNow() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    await Deployment.findByIdAndUpdate(id, {
      $push: { logs: { $each: batch, $slice: -DEPLOYMENT_LOG_LIMIT } },
    });
    lastFlushedAt = Date.now();
  }

  return {
    async log(line: string) {
      const text = String(line ?? "");
      pending.push(text);
      deployBus.publish(topic, { type: "log", line: text });
      // Flush at most every 500ms to bound DB writes.
      if (Date.now() - lastFlushedAt > 500) {
        await flushNow();
      }
    },
    async flush(force = false) {
      if (force || pending.length > 0) await flushNow();
    },
  };
}

function publishStatus(deploymentId: string, status: string) {
  deployBus.publish(deployTopic(deploymentId), { type: "status", status });
}

async function fail(dep: DepDoc, message: string) {
  dep.status = "failed";
  dep.errorMessage = message;
  dep.finishedAt = new Date();
  await dep.save();
  publishStatus(String(dep._id), "failed");
}
