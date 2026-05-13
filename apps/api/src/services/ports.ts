import { createServer } from "node:net";
import { Application } from "../models/Application.ts";

const RANGE_START = 10_000;
const RANGE_END = 19_999;

async function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer() as unknown as {
      on: (ev: string, fn: (...args: unknown[]) => void) => void;
      listen: (port: number, host: string) => void;
      close: (cb?: () => void) => void;
    };
    server.on("error", () => resolve(false));
    server.on("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Find a port that is not currently assigned to another Application document
 * AND is free on the local host. Throws if the range is exhausted.
 */
export async function allocatePort(excludeAppId?: string): Promise<number> {
  const used = await Application.find(
    excludeAppId
      ? { _id: { $ne: excludeAppId }, port: { $ne: null } }
      : { port: { $ne: null } },
  )
    .select("port")
    .lean();
  const taken = new Set(used.map((a) => a.port).filter((p): p is number => !!p));

  for (let port = RANGE_START; port <= RANGE_END; port++) {
    if (taken.has(port)) continue;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port in range ${RANGE_START}-${RANGE_END}`);
}

export const _internal = { RANGE_START, RANGE_END, isPortFree };
