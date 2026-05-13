import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { PublicDeploymentWithLogs } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Card, CardTitle, CardDescription } from "../components/ui/Card";
import { StatusPill } from "../components/ui/StatusPill";
import { LogViewer } from "../components/LogViewer";

const TERMINAL = new Set(["live", "failed", "cancelled"]);

export default function DeploymentDetailPage() {
  const { appId, deploymentId } = useParams<{
    appId: string;
    deploymentId: string;
  }>();
  const { currentTeamId } = useAuth();
  const [dep, setDep] = useState<PublicDeploymentWithLogs | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("queued");
  const [error, setError] = useState<string | null>(null);

  // Initial load to fill state + existing log lines.
  useEffect(() => {
    if (!currentTeamId || !appId || !deploymentId) return;
    setLines([]);
    api<PublicDeploymentWithLogs>(
      `/teams/${currentTeamId}/apps/${appId}/deployments/${deploymentId}`,
    )
      .then((d) => {
        setDep(d);
        setLines(d.logs);
        setStatus(d.status);
      })
      .catch((e: Error) => setError(e.message));
  }, [currentTeamId, appId, deploymentId]);

  // SSE stream for live updates.
  useEffect(() => {
    if (!currentTeamId || !appId || !deploymentId) return;
    if (TERMINAL.has(status) && dep) return; // nothing to stream

    const es = new EventSource(
      `/api/teams/${currentTeamId}/apps/${appId}/deployments/${deploymentId}/stream`,
      { withCredentials: true },
    );

    const onLog = (e: MessageEvent) =>
      setLines((cur) => [...cur, (e.data as string) ?? ""]);
    const onStatus = (e: MessageEvent) => setStatus(String(e.data));
    const onDone = () => es.close();

    es.addEventListener("log", onLog as EventListener);
    es.addEventListener("status", onStatus as EventListener);
    es.addEventListener("done", onDone as EventListener);
    es.onerror = () => {
      // Browsers auto-reconnect; nothing to do.
    };

    return () => {
      es.removeEventListener("log", onLog as EventListener);
      es.removeEventListener("status", onStatus as EventListener);
      es.removeEventListener("done", onDone as EventListener);
      es.close();
    };
    // status intentionally not included to avoid re-subscribing on every event
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTeamId, appId, deploymentId]);

  if (error) return <p className="text-sm text-red-400">{error}</p>;
  if (!dep) return <p className="text-neutral-500">Loading…</p>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center gap-3">
        <Link to={`/apps/${appId}`} className="text-sm text-neutral-400 underline">
          ← back to app
        </Link>
        <h1 className="text-2xl font-bold tracking-tight">Deployment</h1>
        <StatusPill
          status={
            status === "live"
              ? "running"
              : status === "failed"
                ? "errored"
                : status === "building" || status === "queued"
                  ? "deploying"
                  : "created"
          }
        />
        <span className="font-mono text-xs text-neutral-500">
          {dep.commitSha ? dep.commitSha.slice(0, 7) : "no commit"} ·{" "}
          {dep.branch || "—"} · {dep.triggeredBy}
        </span>
      </header>

      {dep.commitMessage && (
        <Card>
          <CardTitle>Commit</CardTitle>
          <CardDescription className="mt-1 whitespace-pre-wrap font-mono">
            {dep.commitMessage}
          </CardDescription>
        </Card>
      )}

      <Card>
        <CardTitle>Build log</CardTitle>
        <div className="mt-3">
          <LogViewer lines={lines} />
        </div>
      </Card>

      {dep.errorMessage && (
        <Card>
          <CardTitle>Error</CardTitle>
          <CardDescription className="mt-1 text-red-300">
            {dep.errorMessage}
          </CardDescription>
        </Card>
      )}
    </div>
  );
}
