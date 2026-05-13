export type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  onLine: (line: string) => void;
};

/**
 * Spawn a process and stream both stdout and stderr line-by-line into the
 * callback. Resolves with the exit code.
 */
export async function runStreaming(
  cmd: string[],
  opts: SpawnOptions,
): Promise<number> {
  const proc = Bun.spawn(cmd, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>,
    stdout: "pipe",
    stderr: "pipe",
  });

  await Promise.all([
    pipeLines(proc.stdout as ReadableStream<Uint8Array>, opts.onLine),
    pipeLines(proc.stderr as ReadableStream<Uint8Array>, opts.onLine),
  ]);

  return await proc.exited;
}

async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx = buf.indexOf("\n");
    while (idx >= 0) {
      onLine(buf.slice(0, idx).replace(/\r$/, ""));
      buf = buf.slice(idx + 1);
      idx = buf.indexOf("\n");
    }
  }
  buf += decoder.decode();
  if (buf.length > 0) onLine(buf.replace(/\r$/, ""));
}

/** Convenience for running a shell command line via bash. */
export function runShell(
  command: string,
  opts: SpawnOptions,
): Promise<number> {
  return runStreaming(["bash", "-lc", command], opts);
}
