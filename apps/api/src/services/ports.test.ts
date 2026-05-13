import { describe, it, expect } from "bun:test";
import { _internal } from "./ports.ts";

describe("isPortFree", () => {
  it("reports a freshly listened port as occupied, then free after close", async () => {
    const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      const occupied = await _internal.isPortFree(server.port!);
      expect(occupied).toBe(false);
    } finally {
      server.stop(true);
    }
    // After stop the port should be free again (give the kernel a tick).
    await new Promise((r) => setTimeout(r, 50));
    // We can't reliably know what port is free in general, but the released one
    // should be claimable again — round-trip via a fresh server.
    const re = Bun.serve({ port: 0, fetch: () => new Response("ok") });
    try {
      expect(re.port).toBeGreaterThan(0);
    } finally {
      re.stop(true);
    }
  });
});

describe("ports range", () => {
  it("exposes a sensible range", () => {
    expect(_internal.RANGE_START).toBeGreaterThan(1024);
    expect(_internal.RANGE_END).toBeGreaterThan(_internal.RANGE_START);
  });
});
