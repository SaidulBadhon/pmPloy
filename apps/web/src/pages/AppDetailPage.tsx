import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import type { PublicApplication } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import { bytes, ms } from "../lib/format";

export default function AppDetailPage() {
  const { appId } = useParams<{ appId: string }>();
  const navigate = useNavigate();
  const { currentTeamId, teams } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const canManage = team?.role && team.role !== "viewer";
  const canDelete = team?.role === "owner" || team?.role === "admin";

  const [app, setApp] = useState<PublicApplication | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!currentTeamId || !appId) return;
    try {
      const a = await api<PublicApplication>(`/teams/${currentTeamId}/apps/${appId}`);
      setApp(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, [currentTeamId, appId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!app || !currentTeamId || !appId) return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [app, currentTeamId, appId, load]);

  async function action(verb: "start" | "stop" | "restart") {
    if (!currentTeamId || !appId) return;
    setBusy(verb);
    setError(null);
    try {
      const a = await api<PublicApplication>(
        `/teams/${currentTeamId}/apps/${appId}/${verb}`,
        { method: "POST" },
      );
      setApp(a);
    } catch (err) {
      setError(err instanceof Error ? err.message : `${verb} failed`);
    } finally {
      setBusy(null);
    }
  }

  async function onDelete() {
    if (!currentTeamId || !appId) return;
    if (!confirm("Delete this application and stop its PM2 process?")) return;
    setBusy("delete");
    try {
      await api(`/teams/${currentTeamId}/apps/${appId}`, { method: "DELETE" });
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "delete failed");
      setBusy(null);
    }
  }

  if (!app) {
    return (
      <div className="space-y-2">
        {error && <p className="text-sm text-red-400">{error}</p>}
        {!error && <p className="text-neutral-500">Loading…</p>}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{app.name}</h1>
        <StatusPill status={app.status} />
        <span className="font-mono text-xs text-neutral-500">{app.pm2Name}</span>
        <div className="ml-auto flex gap-2">
          {canManage && (
            <>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => action("start")}
              >
                {busy === "start" ? "Starting…" : "Start"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => action("restart")}
              >
                {busy === "restart" ? "Restarting…" : "Restart"}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => action("stop")}
              >
                {busy === "stop" ? "Stopping…" : "Stop"}
              </Button>
            </>
          )}
          {canDelete && (
            <Button
              size="sm"
              variant="danger"
              disabled={busy !== null}
              onClick={onDelete}
            >
              {busy === "delete" ? "Deleting…" : "Delete"}
            </Button>
          )}
        </div>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardTitle>Process</CardTitle>
          <CardDescription className="mt-1">PM2 runtime snapshot.</CardDescription>
          <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-neutral-500">status</dt>
            <dd className="font-mono">{app.pm2?.status ?? "not running"}</dd>
            <dt className="text-neutral-500">pid</dt>
            <dd className="font-mono">{app.pm2?.pid || "—"}</dd>
            <dt className="text-neutral-500">cpu</dt>
            <dd className="font-mono">{app.pm2 ? `${app.pm2.cpu}%` : "—"}</dd>
            <dt className="text-neutral-500">memory</dt>
            <dd className="font-mono">{app.pm2 ? bytes(app.pm2.memory) : "—"}</dd>
            <dt className="text-neutral-500">uptime</dt>
            <dd className="font-mono">{app.pm2 ? ms(app.pm2.uptime) : "—"}</dd>
            <dt className="text-neutral-500">restarts</dt>
            <dd className="font-mono">{app.pm2?.restarts ?? 0}</dd>
          </dl>
        </Card>

        <Card>
          <CardTitle>Configuration</CardTitle>
          <CardDescription className="mt-1">
            Edit via the API; UI inline edit lands later.
          </CardDescription>
          <dl className="mt-4 grid grid-cols-[8rem,1fr] gap-y-2 text-sm">
            <dt className="text-neutral-500">cwd</dt>
            <dd className="break-all font-mono">{app.cwd}</dd>
            <dt className="text-neutral-500">script</dt>
            <dd className="break-all font-mono">{app.script}</dd>
            <dt className="text-neutral-500">interpreter</dt>
            <dd className="font-mono">{app.interpreter || "—"}</dd>
            <dt className="text-neutral-500">instances</dt>
            <dd className="font-mono">{app.instances}</dd>
            <dt className="text-neutral-500">exec mode</dt>
            <dd className="font-mono">{app.execMode}</dd>
            <dt className="text-neutral-500">port</dt>
            <dd className="font-mono">{app.port ?? "—"}</dd>
          </dl>
        </Card>
      </div>
    </div>
  );
}
