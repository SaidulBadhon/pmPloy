import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { PublicApplication } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { StatusPill } from "../components/ui/StatusPill";
import { bytes } from "../lib/format";

export default function AppsListPage() {
  const { teams, currentTeamId } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const [apps, setApps] = useState<PublicApplication[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!currentTeamId) return;
    setApps(null);
    api<{ apps: PublicApplication[] }>(`/teams/${currentTeamId}/apps`)
      .then((d) => setApps(d.apps))
      .catch((e: Error) => setError(e.message));
  }, [currentTeamId]);

  if (!team) return <p className="text-neutral-400">No team selected.</p>;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Applications</h1>
          <p className="text-neutral-400">Processes managed by pmPloy + PM2.</p>
        </div>
        <Link to="/apps/new">
          <Button>New application</Button>
        </Link>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {apps === null && <p className="text-neutral-500">Loading…</p>}

      {apps && apps.length === 0 && (
        <Card>
          <CardTitle>No applications yet</CardTitle>
          <CardDescription className="mt-1">
            Create one manually by pointing pmPloy at a local script and PM2 will
            keep it alive. GitHub repos land in the next milestone.
          </CardDescription>
        </Card>
      )}

      {apps && apps.length > 0 && (
        <ul className="grid gap-3">
          {apps.map((a) => (
            <li key={a.id}>
              <Link to={`/apps/${a.id}`} className="block">
                <Card className="flex items-center gap-4 hover:border-neutral-700">
                  <div className="flex-1">
                    <div className="flex items-center gap-3">
                      <p className="font-medium">{a.name}</p>
                      <StatusPill status={a.status} />
                    </div>
                    <p className="mt-1 truncate text-sm text-neutral-400">
                      <code>{a.script}</code> in <code>{a.cwd}</code>
                    </p>
                  </div>
                  <dl className="hidden gap-6 text-right text-xs text-neutral-500 sm:flex">
                    <div>
                      <dt>port</dt>
                      <dd className="font-mono text-neutral-300">
                        {a.port ?? "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>cpu</dt>
                      <dd className="font-mono text-neutral-300">
                        {a.pm2 ? `${a.pm2.cpu}%` : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>mem</dt>
                      <dd className="font-mono text-neutral-300">
                        {a.pm2 ? bytes(a.pm2.memory) : "—"}
                      </dd>
                    </div>
                  </dl>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
