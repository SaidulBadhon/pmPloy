import { useEffect, useState, type FormEvent } from "react";
import type { PublicDomain, SslStatus } from "@pmploy/shared";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { Card, CardDescription, CardTitle } from "./ui/Card";
import { cn } from "../lib/cn";

const SSL_STYLE: Record<SslStatus, string> = {
  active: "border-emerald-600 text-emerald-300",
  pending: "border-amber-600 text-amber-300",
  error: "border-red-600 text-red-300",
  unknown: "border-neutral-600 text-neutral-400",
};

export function DomainsCard({
  teamId,
  appId,
  canManage,
  canDelete,
}: {
  teamId: string;
  appId: string;
  canManage: boolean;
  canDelete: boolean;
}) {
  const [domains, setDomains] = useState<PublicDomain[] | null>(null);
  const [host, setHost] = useState("");
  const [caddyReachable, setCaddyReachable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const [d, s] = await Promise.all([
        api<{ domains: PublicDomain[] }>(`/teams/${teamId}/apps/${appId}/domains`),
        api<{ reachable: boolean }>(`/caddy/status`),
      ]);
      setDomains(d.domains);
      setCaddyReachable(s.reachable);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }

  useEffect(() => {
    setDomains(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, appId]);

  async function onAttach(e: FormEvent) {
    e.preventDefault();
    setBusy("attach");
    setError(null);
    try {
      const dom = await api<PublicDomain>(`/teams/${teamId}/apps/${appId}/domains`, {
        method: "POST",
        body: { host },
      });
      setDomains((cur) => (cur ? [dom, ...cur] : [dom]));
      setHost("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "attach failed");
    } finally {
      setBusy(null);
    }
  }

  async function onRetry(id: string) {
    setBusy(id);
    try {
      const dom = await api<PublicDomain>(
        `/teams/${teamId}/apps/${appId}/domains/${id}/retry`,
        { method: "POST" },
      );
      setDomains((cur) => (cur ? cur.map((d) => (d.id === id ? dom : d)) : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "retry failed");
    } finally {
      setBusy(null);
    }
  }

  async function onRemove(id: string) {
    if (!confirm("Remove this domain?")) return;
    setBusy(id);
    try {
      await api(`/teams/${teamId}/apps/${appId}/domains/${id}`, { method: "DELETE" });
      setDomains((cur) => (cur ? cur.filter((d) => d.id !== id) : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "remove failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardTitle>Domains</CardTitle>
      <CardDescription className="mt-1">
        Each domain is routed via Caddy with automatic HTTPS. Point your DNS at
        the pmPloy host before attaching.
      </CardDescription>
      {caddyReachable === false && (
        <p className="mt-3 rounded-md border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-200">
          Caddy admin API is unreachable at the configured URL. Routes will be
          saved but not applied until Caddy is running.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <ul className="mt-4 divide-y divide-neutral-800">
        {domains === null && <li className="py-3 text-neutral-500">Loading…</li>}
        {domains && domains.length === 0 && (
          <li className="py-3 text-neutral-500">No domains yet.</li>
        )}
        {domains?.map((d) => (
          <li key={d.id} className="flex items-center gap-3 py-3">
            <span className="flex-1 font-mono text-sm">{d.host}</span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 font-mono text-xs uppercase tracking-wider",
                SSL_STYLE[d.sslStatus],
              )}
              title={d.lastError || undefined}
            >
              {d.sslStatus}
            </span>
            {d.sslStatus === "error" && canManage && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => onRetry(d.id)}
              >
                {busy === d.id ? "Retrying…" : "Retry"}
              </Button>
            )}
            {canDelete && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy !== null}
                onClick={() => onRemove(d.id)}
              >
                Remove
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canManage && (
        <form onSubmit={onAttach} className="mt-6 flex items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="host">Add domain</Label>
            <Input
              id="host"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="api.example.com"
              required
            />
          </div>
          <Button type="submit" disabled={busy !== null || !host}>
            {busy === "attach" ? "Attaching…" : "Attach"}
          </Button>
        </form>
      )}
    </Card>
  );
}
