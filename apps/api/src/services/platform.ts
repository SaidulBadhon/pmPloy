import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { env } from "../env.ts";
import { runStreaming } from "./spawn.ts";

const REPO = env.PMPLOY_REPO_PATH;
const DATA = env.PMPLOY_DATA_DIR;
const UPDATE_LOG = path.join(DATA, "update.log");
const UPDATE_LOCK = path.join(DATA, "update.pid");

export type Commit = {
  sha: string;
  shortSha: string;
  subject: string;
  author: string;
  authoredAt: string;
};

export type PlatformInfo = {
  repoPath: string;
  branch: string;
  head: Commit | null;
  dirty: boolean;
  trackingUpstream: boolean;
};

async function git(args: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const code = await runStreaming(["git", "-C", REPO, ...args], {
    onLine: (l) => lines.push(l),
  });
  return { code, out: lines.join("\n") };
}

async function gitRun(args: string[]): Promise<string> {
  const { code, out } = await git(args);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited ${code}\n${out}`);
  return out.trim();
}

function parseCommitLine(line: string): Commit | null {
  // Format: sha%x09subject%x09author%x09iso-date
  const parts = line.split("\t");
  if (parts.length < 4) return null;
  const [sha, subject, author, authoredAt] = parts;
  if (!sha) return null;
  return {
    sha,
    shortSha: sha.slice(0, 7),
    subject: subject ?? "",
    author: author ?? "",
    authoredAt: authoredAt ?? "",
  };
}

export async function getPlatformInfo(): Promise<PlatformInfo> {
  if (!existsSync(path.join(REPO, ".git"))) {
    return {
      repoPath: REPO,
      branch: "",
      head: null,
      dirty: false,
      trackingUpstream: false,
    };
  }
  const branch = await gitRun(["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "");
  const status = await gitRun(["status", "--porcelain"]).catch(() => "");
  const head = await gitRun([
    "log",
    "-1",
    "--pretty=format:%H%x09%s%x09%an%x09%aI",
  ])
    .then((l) => parseCommitLine(l))
    .catch(() => null);
  let trackingUpstream = false;
  try {
    await gitRun(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    trackingUpstream = true;
  } catch {
    trackingUpstream = false;
  }
  return {
    repoPath: REPO,
    branch,
    head,
    dirty: status.length > 0,
    trackingUpstream,
  };
}

/** Fetch the remote and list commits that origin has and we don't. */
export async function fetchAndDiff(): Promise<Commit[]> {
  await gitRun(["fetch", "--prune", "origin"]);
  const info = await getPlatformInfo();
  if (!info.branch || !info.trackingUpstream) return [];
  const range = `HEAD..origin/${info.branch}`;
  const out = await gitRun([
    "log",
    "--pretty=format:%H%x09%s%x09%an%x09%aI",
    range,
  ]).catch(() => "");
  if (!out) return [];
  return out
    .split("\n")
    .map(parseCommitLine)
    .filter((c): c is Commit => c !== null);
}

export function isUpdateInProgress(): boolean {
  if (!existsSync(UPDATE_LOCK)) return false;
  try {
    const pid = Number(readFileSync(UPDATE_LOCK, "utf8").trim());
    if (!Number.isInteger(pid)) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false; // stale
    }
  } catch {
    return false;
  }
}

export function readUpdateLog(maxBytes = 64 * 1024): string {
  if (!existsSync(UPDATE_LOG)) return "";
  try {
    const buf = readFileSync(UPDATE_LOG);
    if (buf.length <= maxBytes) return buf.toString("utf8");
    return buf.subarray(buf.length - maxBytes).toString("utf8");
  } catch {
    return "";
  }
}

/**
 * Spawn scripts/update.sh fully detached. The API can be killed (by the
 * updater) without taking the script down with it.
 */
export async function startUpdate(target?: string): Promise<void> {
  if (isUpdateInProgress()) {
    throw new Error("an update is already in progress");
  }
  const script = path.join(REPO, "scripts", "update.sh");
  if (!existsSync(script)) {
    throw new Error(`update script missing at ${script}`);
  }

  // setsid + double-fork-ish: nohup detaches stdio, & disowns.
  const cmd = target
    ? `setsid nohup bash ${quote(script)} ${quote(target)} >/dev/null 2>&1 &`
    : `setsid nohup bash ${quote(script)} >/dev/null 2>&1 &`;

  const proc = Bun.spawn(["bash", "-c", cmd], {
    cwd: REPO,
    env: {
      ...process.env,
      PMPLOY_REPO_PATH: REPO,
      PMPLOY_DATA_DIR: DATA,
    } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  // We don't await; the inner shell forks the updater and exits.
  await proc.exited;
}

function quote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * A user is a platform admin if their email is listed in PLATFORM_ADMINS,
 * or — if that env var is empty — they were the first user to sign up.
 */
export function platformAdminsFromEnv(): string[] {
  return env.PLATFORM_ADMINS.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
