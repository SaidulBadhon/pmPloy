import { describe, it, expect } from "bun:test";
import { runStreaming, runShell } from "./spawn.ts";

describe("runStreaming", () => {
  it("streams stdout lines and returns exit code 0", async () => {
    const lines: string[] = [];
    const code = await runStreaming(
      ["bash", "-c", "printf 'one\\ntwo\\nthree\\n'"],
      { onLine: (l) => lines.push(l) },
    );
    expect(code).toBe(0);
    expect(lines).toEqual(["one", "two", "three"]);
  });

  it("captures stderr too", async () => {
    const lines: string[] = [];
    const code = await runStreaming(
      ["bash", "-c", "echo stdout; >&2 echo stderr"],
      { onLine: (l) => lines.push(l) },
    );
    expect(code).toBe(0);
    expect(lines).toContain("stdout");
    expect(lines).toContain("stderr");
  });

  it("propagates non-zero exit codes", async () => {
    const code = await runStreaming(["bash", "-c", "exit 7"], { onLine: () => {} });
    expect(code).toBe(7);
  });

  it("strips trailing CR (Windows line endings)", async () => {
    const lines: string[] = [];
    await runStreaming(["bash", "-c", "printf 'hi\\r\\n'"], {
      onLine: (l) => lines.push(l),
    });
    expect(lines[0]).toBe("hi");
  });
});

describe("runShell", () => {
  it("runs a shell command and reads env", async () => {
    const lines: string[] = [];
    const code = await runShell("echo $MY_VAR", {
      env: { MY_VAR: "hello" },
      onLine: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    expect(lines).toContain("hello");
  });
});
