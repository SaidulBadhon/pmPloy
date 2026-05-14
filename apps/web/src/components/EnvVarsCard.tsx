import { useEffect, useState, type FormEvent } from "react";
import type { PublicEnvVar } from "@pmploy/shared";
import { api } from "../lib/api";
import { Button } from "./ui/Button";
import { Input, Label } from "./ui/Input";
import { Card, CardDescription, CardTitle } from "./ui/Card";

export type EnvScope =
  | { type: "app" }
  | { type: "service"; serviceName: string };

export function EnvVarsCard({
  teamId,
  appId,
  canManage,
  scope = { type: "app" },
}: {
  teamId: string;
  appId: string;
  canManage: boolean;
  scope?: EnvScope;
}) {
  const [vars, setVars] = useState<PublicEnvVar[] | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");

  const basePath =
    scope.type === "app"
      ? `/teams/${teamId}/apps/${appId}/env`
      : `/teams/${teamId}/apps/${appId}/services/${encodeURIComponent(
          scope.serviceName,
        )}/env`;

  async function load() {
    setError(null);
    try {
      const [v, s] = await Promise.all([
        api<{ vars: PublicEnvVar[] }>(basePath),
        api<{ configured: boolean }>(`/env/status`),
      ]);
      setVars(v.vars);
      setConfigured(s.configured);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }

  useEffect(() => {
    setVars(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId, appId, scope.type, scope.type === "service" ? scope.serviceName : ""]);

  async function onUpsert(e: FormEvent) {
    e.preventDefault();
    if (!key) return;
    setBusy("upsert");
    setError(null);
    try {
      await api(`${basePath}/${encodeURIComponent(key)}`, {
        method: "PUT",
        body: { value },
      });
      setKey("");
      setValue("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "save failed");
    } finally {
      setBusy(null);
    }
  }

  async function onDelete(k: string) {
    if (!confirm(`Delete ${k}?`)) return;
    setBusy(k);
    try {
      await api(`${basePath}/${encodeURIComponent(k)}`, { method: "DELETE" });
      setVars((cur) => (cur ? cur.filter((v) => v.key !== k) : cur));
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
    } finally {
      setBusy(null);
    }
  }

  const title =
    scope.type === "app"
      ? "Environment variables"
      : "Service environment overrides";
  const description =
    scope.type === "app"
      ? "Values are encrypted at rest with AES-256-GCM and injected into every service on start."
      : "Overrides for this service. These take precedence over the app-level shared variables.";

  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <CardDescription className="mt-1">{description}</CardDescription>
      {configured === false && (
        <p className="mt-3 rounded-md border border-amber-700 bg-amber-950/40 p-3 text-xs text-amber-200">
          Set <code>ENV_ENCRYPTION_KEY</code> to a 32-byte base64 value (e.g.
          <code>openssl rand -base64 32</code>) and restart the API before
          adding secrets.
        </p>
      )}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <ul className="mt-4 divide-y divide-neutral-800">
        {vars === null && <li className="py-3 text-neutral-500">Loading…</li>}
        {vars && vars.length === 0 && (
          <li className="py-3 text-neutral-500">
            {scope.type === "app" ? "No variables yet." : "No overrides yet."}
          </li>
        )}
        {vars?.map((v) => (
          <li key={v.id} className="flex items-center gap-3 py-3">
            <span className="flex-1 font-mono text-sm">{v.key}</span>
            <span className="font-mono text-xs text-neutral-500">●●●●●●</span>
            {canManage && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy !== null}
                onClick={() => onDelete(v.key)}
              >
                Delete
              </Button>
            )}
          </li>
        ))}
      </ul>

      {canManage && configured !== false && (
        <form onSubmit={onUpsert} className="mt-6 grid grid-cols-[1fr,2fr,auto] gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`env-key-${scope.type}`}>Key</Label>
            <Input
              id={`env-key-${scope.type}`}
              value={key}
              onChange={(e) => setKey(e.target.value.toUpperCase())}
              placeholder="DATABASE_URL"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`env-val-${scope.type}`}>Value</Label>
            <Input
              id={`env-val-${scope.type}`}
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="postgres://…"
            />
          </div>
          <div className="flex items-end">
            <Button type="submit" disabled={busy !== null || !key}>
              {busy === "upsert" ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
