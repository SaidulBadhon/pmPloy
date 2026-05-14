import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";

export type LogEvent = { stream: "stdout" | "stderr"; line: string };

export type TailOptions = {
  stdoutPath: string;
  stderrPath: string;
  tailLines?: number;
  signal?: AbortSignal;
};

/**
 * Stream new lines appended to a pair of PM2 log files. On first iterate,
 * yields the last `tailLines` lines from each existing file (newest at the end).
 * Then watches both files and yields new lines as they arrive. Stops cleanly
 * when the signal is aborted.
 */
export async function* tailProcessLogs(opts: TailOptions): AsyncIterable<LogEvent> {
  const tail = opts.tailLines ?? 200;

  // Snapshot the existing tail of each file AND record its byte length in one
  // pass so writes that race the snapshot can't be silently dropped by the
  // subsequent watcher.
  const offsets = new Map<string, number>();
  for (const [stream, file] of [
    ["stdout", opts.stdoutPath] as const,
    ["stderr", opts.stderrPath] as const,
  ]) {
    if (!existsSync(file)) {
      offsets.set(file, 0);
      continue;
    }
    const buf = await readFile(file);
    offsets.set(file, buf.length);
    const content = buf.toString("utf-8");
    const lines = content.split("\n");
    if (lines.at(-1) === "") lines.pop();
    const slice = lines.slice(Math.max(0, lines.length - tail));
    for (const line of slice) yield { stream, line };
  }

  const queue: LogEvent[] = [];
  let resolve: (() => void) | null = null;
  const wake = () => {
    resolve?.();
    resolve = null;
  };

  const watchers = [
    watchFile(opts.stdoutPath, "stdout"),
    watchFile(opts.stderrPath, "stderr"),
  ];

  function watchFile(file: string, stream: "stdout" | "stderr") {
    if (!existsSync(path.dirname(file))) return { close: () => {} };
    try {
      const w = watch(file, { persistent: false }, async () => {
        try {
          const buf = await readFile(file);
          const prev = offsets.get(file) ?? 0;
          if (buf.length <= prev) {
            // File truncated/rotated — reset.
            offsets.set(file, buf.length);
            return;
          }
          const chunk = buf.subarray(prev).toString("utf-8");
          offsets.set(file, buf.length);
          const lines = chunk.split("\n");
          if (lines.at(-1) === "") lines.pop();
          for (const line of lines) queue.push({ stream, line });
          wake();
        } catch {
          // best-effort
        }
      });
      return w;
    } catch {
      return { close: () => {} };
    }
  }

  const onAbort = () => wake();
  opts.signal?.addEventListener("abort", onAbort, { once: true });

  try {
    while (!opts.signal?.aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      await new Promise<void>((r) => {
        resolve = r;
      });
    }
  } finally {
    opts.signal?.removeEventListener("abort", onAbort);
    for (const w of watchers) {
      try {
        (w as { close?: () => void }).close?.();
      } catch {
        // ignore
      }
    }
  }
}

/** Resolve the conventional PM2 log file paths for a process name. */
export function pm2LogPaths(pm2Name: string): { stdout: string; stderr: string } {
  const home = process.env.HOME ?? "";
  return {
    stdout: path.join(home, ".pm2", "logs", `${pm2Name}-out.log`),
    stderr: path.join(home, ".pm2", "logs", `${pm2Name}-error.log`),
  };
}
