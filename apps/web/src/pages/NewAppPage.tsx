import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { ExecMode, PublicApplication } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

export default function NewAppPage() {
  const { currentTeamId, teams } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const navigate = useNavigate();

  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [script, setScript] = useState("");
  const [interpreter, setInterpreter] = useState("");
  const [instances, setInstances] = useState(1);
  const [execMode, setExecMode] = useState<ExecMode>("fork");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canCreate = team?.role && team.role !== "viewer";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      const app = await api<PublicApplication>(`/teams/${currentTeamId}/apps`, {
        method: "POST",
        body: { name, cwd, script, interpreter, instances, execMode },
      });
      navigate(`/apps/${app.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "create failed");
    } finally {
      setSubmitting(false);
    }
  }

  if (!team) return <p className="text-neutral-400">No team selected.</p>;
  if (!canCreate) {
    return <p className="text-neutral-400">Your role can't create apps.</p>;
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">New application</h1>
        <p className="text-neutral-400">
          Point pmPloy at a local script — PM2 will manage the process.
        </p>
      </header>

      <Card>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-api"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cwd">Working directory</Label>
            <Input
              id="cwd"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
              placeholder="/srv/my-api"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="script">Script / entrypoint</Label>
            <Input
              id="script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder="index.js"
              required
            />
            <CardDescription>
              File to execute (passed straight to PM2). Relative to the working
              directory, or absolute.
            </CardDescription>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="interpreter">Interpreter (optional)</Label>
              <Input
                id="interpreter"
                value={interpreter}
                onChange={(e) => setInterpreter(e.target.value)}
                placeholder="bun, node, python…"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="instances">Instances</Label>
              <Input
                id="instances"
                type="number"
                min={1}
                max={64}
                value={instances}
                onChange={(e) => setInstances(Number(e.target.value) || 1)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="execMode">Exec mode</Label>
            <select
              id="execMode"
              value={execMode}
              onChange={(e) => setExecMode(e.target.value as ExecMode)}
              className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
            >
              <option value="fork">fork</option>
              <option value="cluster">cluster</option>
            </select>
          </div>
          {error && <p className="text-sm text-red-400">{error}</p>}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => navigate(-1)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create application"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
