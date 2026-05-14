import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { tailProcessLogs } from "./processLogs.ts";

async function makeLogDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "pmploy-logs-"));
}

describe("tailProcessLogs", () => {
  test("emits the tail of an existing log file then watches for new lines", async () => {
    const dir = await makeLogDir();
    const out = path.join(dir, "svc-out.log");
    const err = path.join(dir, "svc-error.log");
    await writeFile(out, "line1\nline2\n");
    await writeFile(err, "");

    const collected: { stream: "stdout" | "stderr"; line: string }[] = [];
    const abort = new AbortController();

    const consumer = (async () => {
      for await (const ev of tailProcessLogs({
        stdoutPath: out,
        stderrPath: err,
        signal: abort.signal,
        tailLines: 10,
      })) {
        collected.push(ev);
        if (collected.length >= 3) {
          abort.abort();
          break;
        }
      }
    })();

    // Allow the head emit to happen, then append a new line.
    await new Promise((r) => setTimeout(r, 50));
    await appendFile(out, "line3\n");

    await consumer;
    expect(collected.map((e) => e.line)).toEqual(["line1", "line2", "line3"]);
    expect(collected.every((e) => e.stream === "stdout")).toBe(true);
  });

  test("emits nothing for missing files but does not throw", async () => {
    const abort = new AbortController();
    const events: unknown[] = [];
    const consumer = (async () => {
      for await (const ev of tailProcessLogs({
        stdoutPath: "/tmp/does-not-exist-1.log",
        stderrPath: "/tmp/does-not-exist-2.log",
        signal: abort.signal,
        tailLines: 10,
      })) {
        events.push(ev);
      }
    })();
    setTimeout(() => abort.abort(), 50);
    await consumer;
    expect(events).toEqual([]);
  });
});
