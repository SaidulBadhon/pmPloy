import { describe, it, expect } from "bun:test";
import { CaddyClient, type Fetcher } from "./caddy.ts";

type Call = {
  url: string;
  method: string;
  body?: unknown;
};

function makeFetcher(
  handler: (call: Call) => { status?: number; body?: string },
): { fetch: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const bodyText = init?.body ? String(init.body) : undefined;
    const body = bodyText ? safeJson(bodyText) : undefined;
    const call = { url, method, body };
    calls.push(call);
    const r = handler(call);
    const status = r.status ?? 200;
    return new Response(r.body ?? "", { status }) as Response;
  };
  return { fetch: fetcher, calls };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

describe("CaddyClient.ping", () => {
  it("returns true on 200 from /config/", async () => {
    const { fetch } = makeFetcher(() => ({ status: 200 }));
    const c = new CaddyClient("http://caddy", fetch);
    expect(await c.ping()).toBe(true);
  });

  it("returns false on network error", async () => {
    const c = new CaddyClient("http://caddy", (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as Fetcher);
    expect(await c.ping()).toBe(false);
  });
});

describe("CaddyClient.ensureServer", () => {
  it("PUTs default server config when srv0 is 404", async () => {
    const { fetch, calls } = makeFetcher((call) => {
      if (call.method === "GET") return { status: 404 };
      if (call.method === "PUT") return { status: 200 };
      return { status: 500 };
    });
    const c = new CaddyClient("http://caddy", fetch);
    await c.ensureServer();
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]?.method).toBe("PUT");
    expect(calls[1]?.body).toMatchObject({ listen: [":443", ":80"] });
  });

  it("noops when srv0 already exists", async () => {
    const { fetch, calls } = makeFetcher(() => ({ status: 200 }));
    const c = new CaddyClient("http://caddy", fetch);
    await c.ensureServer();
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
  });
});

describe("CaddyClient.upsertDomain", () => {
  it("appends a new route when id is unknown", async () => {
    const { fetch, calls } = makeFetcher((call) => {
      if (call.url.endsWith("/config/apps/http/servers/srv0") && call.method === "GET")
        return { status: 200 };
      if (call.url.includes("/id/") && call.method === "GET") return { status: 404 };
      if (
        call.url.endsWith("/config/apps/http/servers/srv0/routes") &&
        call.method === "POST"
      )
        return { status: 200 };
      return { status: 500 };
    });
    const c = new CaddyClient("http://caddy", fetch);
    await c.upsertDomain("api.example.com", 10042);
    const append = calls.find((x) => x.method === "POST")!;
    expect(append.body).toMatchObject({
      "@id": "pmploy:domain:api.example.com",
      match: [{ host: ["api.example.com"] }],
    });
    const handle = (append.body as { handle: { upstreams: { dial: string }[] }[] })
      .handle[0]!.upstreams[0]!;
    expect(handle.dial).toBe("127.0.0.1:10042");
  });

  it("PATCHes the existing route when the id is known", async () => {
    const { fetch, calls } = makeFetcher((call) => {
      if (call.url.endsWith("/config/apps/http/servers/srv0") && call.method === "GET")
        return { status: 200 };
      if (call.url.includes("/id/") && call.method === "GET") return { status: 200 };
      if (call.url.includes("/id/") && call.method === "PATCH") return { status: 200 };
      return { status: 500 };
    });
    const c = new CaddyClient("http://caddy", fetch);
    await c.upsertDomain("api.example.com", 12345);
    expect(calls.find((x) => x.method === "POST")).toBeUndefined();
    expect(calls.find((x) => x.method === "PATCH")).toBeDefined();
  });
});

describe("CaddyClient.removeDomain", () => {
  it("DELETEs the route by id", async () => {
    const { fetch, calls } = makeFetcher(() => ({ status: 200 }));
    const c = new CaddyClient("http://caddy", fetch);
    await c.removeDomain("api.example.com");
    expect(calls[0]).toMatchObject({
      method: "DELETE",
      url: "http://caddy/id/pmploy%3Adomain%3Aapi.example.com",
    });
  });

  it("tolerates a 404 (already gone)", async () => {
    const { fetch } = makeFetcher(() => ({ status: 404 }));
    const c = new CaddyClient("http://caddy", fetch);
    await c.removeDomain("api.example.com");
  });
});
