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

    // Best-effort: refresh Caddy routes (port may have changed) and prune.
    await resyncDomains(String(app._id), app.port ?? null, ctx).catch(() => undefined);
    await pruneOldDeployDirs(String(app._id)).catch(() => undefined);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.log(`✗ ${message}`);
    await fail(dep, message);
    app.status = "errored";
    await app.save().catch(() => undefined);
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
  await ctx.log(`▶ launching ${app.script} in ${app.cwd}`);
  await startApp(app, ctx);
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

  await ctx.log(`▶ launching ${app.script} in ${buildDir}`);
  await startApp(app, ctx);
}

async function startApp(app: AppDoc, ctx: LogContext): Promise<void> {
  const name = pm2NameForApp(String(app._id));
  // Make sure any prior instance is torn down so it picks up the new cwd.
  await deleteProcess(name).catch(() => undefined);
  const info = await startProcess({
    name,
    cwd: app.cwd,
    script: app.script,
    interpreter: app.interpreter || undefined,
    instances: app.instances ?? 1,
    execMode: app.execMode,
    env: { PORT: String(app.port ?? "") },
  });
  await ctx.log(`▶ pm2 status: ${info.status}, pid ${info.pid}`);
  // Give PM2 a moment to settle, then re-check.
  await new Promise((r) => setTimeout(r, 250));
  const after = await describeProcess(name).catch(() => null);
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
