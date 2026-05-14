import pm2 from "pm2";
import type { ProcessDescription, StartOptions } from "pm2";

export type Pm2Status =
  | "online"
  | "stopping"
  | "stopped"
  | "launching"
  | "errored"
  | "one-launch-status";

export type Pm2Info = {
  name: string;
  pid: number;
  status: Pm2Status | "unknown";
  cpu: number;
  memory: number;
  uptime: number;
  restarts: number;
};

/** Connect to (or spawn) the local PM2 daemon. */
function connect(): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.connect((err) => (err ? reject(err) : resolve()));
  });
}

function disconnect(): void {
  pm2.disconnect();
}

async function withDaemon<T>(fn: () => Promise<T>): Promise<T> {
  await connect();
  try {
    return await fn();
  } finally {
    disconnect();
  }
}

export type StartArgs = {
  name: string;
  cwd: string;
  script: string;
  interpreter?: string;
  args?: string;
  instances?: number;
  execMode?: "fork" | "cluster";
  env?: Record<string, string>;
};

/** Start (or replace) a process by name. */
export async function startProcess(args: StartArgs): Promise<Pm2Info> {
  return withDaemon(async () => {
    // If a process by this name exists, delete it first so config is fresh.
    await deleteByNameInternal(args.name).catch(() => undefined);

    const opts: StartOptions = {
      name: args.name,
      script: args.script,
      cwd: args.cwd,
      instances: args.instances ?? 1,
      exec_mode: args.execMode ?? "fork",
      env: args.env ?? {},
    };
    if (args.interpreter) opts.interpreter = args.interpreter;
    if (args.args) opts.args = args.args;

    const procs = await new Promise<ProcessDescription[]>((resolve, reject) => {
      pm2.start(opts, (err, apps) => {
        if (err) return reject(err);
        resolve((apps as unknown as ProcessDescription[]) ?? []);
      });
    });
    const first = procs[0];
    return toInfo(first ?? { name: args.name });
  });
}

export async function stopProcess(name: string): Promise<void> {
  await withDaemon(
    () =>
      new Promise<void>((resolve, reject) => {
        pm2.stop(name, (err) => (err ? reject(err) : resolve()));
      }),
  );
}

export async function restartProcess(name: string): Promise<void> {
  await withDaemon(
    () =>
      new Promise<void>((resolve, reject) => {
        pm2.restart(name, (err) => (err ? reject(err) : resolve()));
      }),
  );
}

export async function deleteProcess(name: string): Promise<void> {
  await withDaemon(() => deleteByNameInternal(name));
}

function deleteByNameInternal(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    pm2.delete(name, (err) => {
      if (err) {
        // "process or namespace not found" is OK on a fresh start.
        if (/not found/i.test(err.message ?? "")) return resolve();
        return reject(err);
      }
      resolve();
    });
  });
}

export async function describeProcess(name: string): Promise<Pm2Info | null> {
  return withDaemon(async () => {
    const procs = await new Promise<ProcessDescription[]>((resolve, reject) => {
      pm2.describe(name, (err, list) => (err ? reject(err) : resolve(list ?? [])));
    });
    const first = procs[0];
    return first ? toInfo(first) : null;
  });
}

export async function listProcesses(): Promise<Pm2Info[]> {
  return withDaemon(async () => {
    const procs = await new Promise<ProcessDescription[]>((resolve, reject) => {
      pm2.list((err, list) => (err ? reject(err) : resolve(list ?? [])));
    });
    return procs.map(toInfo);
  });
}

function toInfo(p: ProcessDescription): Pm2Info {
  const monit = (p as ProcessDescription & { monit?: { cpu?: number; memory?: number } })
    .monit;
  const env = (
    p as ProcessDescription & {
      pm2_env?: { status?: Pm2Status; pm_uptime?: number; restart_time?: number };
    }
  ).pm2_env;
  return {
    name: p.name ?? "",
    pid: p.pid ?? 0,
    status: env?.status ?? "unknown",
    cpu: monit?.cpu ?? 0,
    memory: monit?.memory ?? 0,
    uptime: env?.pm_uptime ? Date.now() - env.pm_uptime : 0,
    restarts: env?.restart_time ?? 0,
  };
}

export function pm2NameForApp(appId: string): string {
  return pm2NameForService(appId, "default");
}

export function pm2NameForService(appId: string, serviceName: string): string {
  return `pmploy:${appId}:${serviceName}`;
}
