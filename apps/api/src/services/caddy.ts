import { env } from "../env.ts";
import { caddyRouteId } from "../models/Domain.ts";

export type Fetcher = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string },
) => Promise<Response>;

export class CaddyClient {
  constructor(
    private baseUrl: string = env.CADDY_ADMIN_URL,
    private fetcher: Fetcher = fetch,
  ) {}

  /** Probe the Admin API. Returns true if Caddy is reachable. */
  async ping(): Promise<boolean> {
    try {
      const res = await this.fetcher(`${this.baseUrl}/config/`);
      return res.ok;
    } catch {
      return false;
    }
  }

  /** Make sure the `apps/http/servers/srv0` shape exists. */
  async ensureServer(): Promise<void> {
    const res = await this.fetcher(`${this.baseUrl}/config/apps/http/servers/srv0`);
    if (res.ok) return;
    if (res.status !== 404 && res.status !== 200) {
      throw new Error(
        `caddy ensureServer probe failed: HTTP ${res.status} ${await res.text()}`,
      );
    }
    const put = await this.fetcher(
      `${this.baseUrl}/config/apps/http/servers/srv0`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listen: [":443", ":80"],
          routes: [],
          automatic_https: {},
        }),
      },
    );
    if (!put.ok) {
      throw new Error(
        `caddy ensureServer failed: HTTP ${put.status} ${await put.text()}`,
      );
    }
  }

  /**
   * Upsert a domain route that reverse-proxies to a local port. If a route
   * with the same @id already exists, replace it; otherwise append.
   */
  async upsertDomain(host: string, port: number): Promise<void> {
    await this.ensureServer();
    const id = caddyRouteId(host);
    const route = buildRoute(host, port, id);

    const found = await this.fetcher(`${this.baseUrl}/id/${encodeURIComponent(id)}`);
    if (found.ok) {
      const replace = await this.fetcher(
        `${this.baseUrl}/id/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(route),
        },
      );
      if (!replace.ok) {
        throw new Error(
          `caddy patch route failed: HTTP ${replace.status} ${await replace.text()}`,
        );
      }
      return;
    }

    const append = await this.fetcher(
      `${this.baseUrl}/config/apps/http/servers/srv0/routes`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(route),
      },
    );
    if (!append.ok) {
      throw new Error(
        `caddy append route failed: HTTP ${append.status} ${await append.text()}`,
      );
    }
  }

  /** Remove a previously upserted route. */
  async removeDomain(host: string): Promise<void> {
    const id = caddyRouteId(host);
    const res = await this.fetcher(`${this.baseUrl}/id/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok && res.status !== 404) {
      throw new Error(
        `caddy delete route failed: HTTP ${res.status} ${await res.text()}`,
      );
    }
  }
}

function buildRoute(host: string, port: number, id: string) {
  return {
    "@id": id,
    match: [{ host: [host] }],
    handle: [
      {
        handler: "reverse_proxy",
        upstreams: [{ dial: `127.0.0.1:${port}` }],
      },
    ],
    terminal: true,
  } as const;
}

export const caddy = new CaddyClient();
