import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PublicApplication, PublicEnvVar, PublicService } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import { EnvVarsCard } from "../components/EnvVarsCard";
import { ServiceLogStream } from "../components/ServiceLogStream";
import { bytes, ms } from "../lib/format";

function serviceAppStatus(svc: PublicService): "running" | "stopped" | "errored" | "deploying" {
  const s = svc.pm2?.status;
  if (s === "online") return "running";
  if (s === "errored") return "errored";
  if (s === "launching") return "deploying";
  return "stopped";
}

export default function ServiceDetailPage() {
  const { appId, serviceName } = useParams<{ appId: string; serviceName: string }>();
  const { currentTeamId, teams } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const canManage = team?.role && team.role !== "viewer";

  const [app, setApp] = useState<PublicApplication | null>(null);
  const [sharedVars, setSharedVars] = useState<PublicEnvVar[] | null>(null);
  const [showShared, setShowShared] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!currentTeamId || !appId || !showShared) return;
    if (sharedVars !== null) return;
    api<{ vars: PublicEnvVar[] }>(`/teams/${currentTeamId}/apps/${appId}/env`)
      .then((r) => setSharedVars(r.vars))
      .catch(() => setSharedVars([]));
  }, [currentTeamId, appId, showShared, sharedVars]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!app) return <p className="text-neutral-500">Loading…</p>;

  const svc = app.services.find((s) => s.name === serviceName);
  if (!svc) {
    return (
      <div className="space-y-3">
        <Link to={`/apps/${app.id}`} className="text-sm text-neutral-400 underline">
          ← back to app
        </Link>
        <p className="text-sm text-amber-300">
          Service <span className="font-mono">{serviceName}</span> no longer exists. The
          ecosystem file may have changed since the last deploy.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link to={`/apps/${app.id}`} className="text-sm text-neutral-400 underline">
          ← back to {app.name}
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">{svc.name}</h1>
        <StatusPill status={serviceAppStatus(svc)} />
        {svc.isPrimary && (
          <span className="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-xs uppercase tracking-wider text-neutral-400">
            primary
          </span>
        )}
        <span className="font-mono text-xs text-neutral-500">{svc.pm2Name}</span>
      </header>

      <Card>
        <CardTitle>Process</CardTitle>
        <CardDescription className="mt-1">PM2 runtime snapshot.</CardDescription>
        <dl className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
          <dt className="text-neutral-500">status</dt>
          <dd className="font-mono">{svc.pm2?.status ?? "not running"}</dd>
          <dt className="text-neutral-500">pid</dt>
          <dd className="font-mono">{svc.pm2?.pid || "—"}</dd>
          <dt className="text-neutral-500">port</dt>
          <dd className="font-mono">{svc.port ?? "—"}</dd>
          <dt className="text-neutral-500">cpu</dt>
          <dd className="font-mono">{svc.pm2 ? `${svc.pm2.cpu}%` : "—"}</dd>
          <dt className="text-neutral-500">memory</dt>
          <dd className="font-mono">{svc.pm2 ? bytes(svc.pm2.memory) : "—"}</dd>
          <dt className="text-neutral-500">uptime</dt>
          <dd className="font-mono">{svc.pm2 ? ms(svc.pm2.uptime) : "—"}</dd>
          <dt className="text-neutral-500">restarts</dt>
          <dd className="font-mono">{svc.pm2?.restarts ?? 0}</dd>
        </dl>
      </Card>

      <Card>
        <CardTitle>Logs</CardTitle>
        <CardDescription className="mt-1">
          Live stdout / stderr from this PM2 process. Reading from{" "}
          <code>~/.pm2/logs/{svc.pm2Name}-*.log</code>.
        </CardDescription>
        <div className="mt-3">
          {currentTeamId && (
            <ServiceLogStream
              teamId={currentTeamId}
              appId={app.id}
              serviceName={svc.name}
            />
          )}
        </div>
      </Card>

      {currentTeamId && (
        <EnvVarsCard
          teamId={currentTeamId}
          appId={app.id}
          canManage={!!canManage}
          scope={{ type: "service", serviceName: svc.name }}
        />
      )}

      <Card>
        <CardTitle>Shared environment</CardTitle>
        <CardDescription className="mt-1">
          App-level variables applied to every service.{" "}
          <Link to={`/apps/${app.id}`} className="text-neutral-400 underline">
            Edit on the app page
          </Link>
          .
        </CardDescription>
        <button
          type="button"
          onClick={() => setShowShared((v) => !v)}
          className="mt-3 text-xs text-neutral-400 underline"
        >
          {showShared ? "Hide" : "Show"} shared keys
        </button>
        {showShared && (
          <ul className="mt-4 divide-y divide-neutral-800">
            {sharedVars === null && (
              <li className="py-3 text-neutral-500">Loading…</li>
            )}
            {sharedVars && sharedVars.length === 0 && (
              <li className="py-3 text-neutral-500">No shared variables.</li>
            )}
            {sharedVars?.map((v) => (
              <li key={v.id} className="py-2 font-mono text-sm">
                {v.key}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
