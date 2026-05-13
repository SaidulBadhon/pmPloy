import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import type {
  ExecMode,
  GithubBranch,
  GithubInstallation,
  GithubRepo,
  PublicApplication,
} from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { cn } from "../lib/cn";

type Source = "local" | "github";

export default function NewAppPage() {
  const { currentTeamId, teams } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const navigate = useNavigate();
  const canCreate = team?.role && team.role !== "viewer";

  const [source, setSource] = useState<Source>("local");

  const [name, setName] = useState("");
  const [cwd, setCwd] = useState("");
  const [script, setScript] = useState("");
  const [interpreter, setInterpreter] = useState("");
  const [instances, setInstances] = useState(1);
  const [execMode, setExecMode] = useState<ExecMode>("fork");

  const [installations, setInstallations] = useState<GithubInstallation[]>([]);
  const [installationId, setInstallationId] = useState<number | null>(null);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [repoFullName, setRepoFullName] = useState<string>("");
  const [branches, setBranches] = useState<GithubBranch[]>([]);
  const [branch, setBranch] = useState("");
  const [rootDir, setRootDir] = useState("");
  const [buildCommand, setBuildCommand] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!currentTeamId) return;
    api<{ installations: GithubInstallation[] }>(
      `/teams/${currentTeamId}/github/installations`,
    )
      .then((d) => {
        setInstallations(d.installations);
        if (d.installations[0]) setInstallationId(d.installations[0].installationId);
      })
      .catch(() => undefined);
  }, [currentTeamId]);

  useEffect(() => {
    if (source !== "github" || !currentTeamId || !installationId) return;
    setRepos([]);
    setBranches([]);
    setRepoFullName("");
    setBranch("");
    api<{ repos: GithubRepo[] }>(
      `/teams/${currentTeamId}/github/installations/${installationId}/repos`,
    )
      .then((d) => setRepos(d.repos))
      .catch((e: Error) => setError(e.message));
  }, [source, currentTeamId, installationId]);

  useEffect(() => {
    if (source !== "github" || !currentTeamId || !installationId || !repoFullName)
      return;
    const [owner, repo] = repoFullName.split("/");
    setBranches([]);
    setBranch("");
    api<{ branches: GithubBranch[] }>(
      `/teams/${currentTeamId}/github/installations/${installationId}/repos/${owner}/${repo}/branches`,
    )
      .then((d) => {
        setBranches(d.branches);
        const defaultBranch = repos.find((r) => r.fullName === repoFullName)
          ?.defaultBranch;
        const pick =
          d.branches.find((b) => b.name === defaultBranch)?.name ??
          d.branches[0]?.name ??
          "main";
        setBranch(pick);
      })
      .catch((e: Error) => setError(e.message));
  }, [source, currentTeamId, installationId, repoFullName, repos]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!currentTeamId) return;
    setSubmitting(true);
    setError(null);
    try {
      const body =
        source === "local"
          ? {
              sourceType: "local",
              name,
              cwd,
              script,
              interpreter,
              instances,
              execMode,
            }
          : {
              sourceType: "github",
              name,
              script,
              interpreter,
              instances,
              execMode,
              github: {
                installationId,
                repo: repoFullName,
                branch,
                rootDir,
                buildCommand,
              },
            };
      const app = await api<PublicApplication>(`/teams/${currentTeamId}/apps`, {
        method: "POST",
        body,
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
          Either point at a local script (manual control) or connect a GitHub
          repo (auto-deploy on push lands in the next milestone).
        </p>
      </header>

      <Card>
        <div className="mb-4 flex gap-2">
          {(["local", "github"] as Source[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSource(s)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-sm",
                source === s
                  ? "border-neutral-300 bg-neutral-100 text-neutral-900"
                  : "border-neutral-700 text-neutral-300 hover:bg-neutral-800",
              )}
            >
              {s === "local" ? "Local script" : "GitHub repo"}
            </button>
          ))}
        </div>

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

          {source === "local" && (
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
          )}

          {source === "github" && (
            <>
              {installations.length === 0 ? (
                <p className="text-sm text-neutral-400">
                  No GitHub installations on this team yet.{" "}
                  <Link to="/settings/github" className="underline">
                    Connect one
                  </Link>{" "}
                  first.
                </p>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="installation">Installation</Label>
                    <select
                      id="installation"
                      value={installationId ?? ""}
                      onChange={(e) => setInstallationId(Number(e.target.value))}
                      className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
                    >
                      {installations.map((i) => (
                        <option key={i.id} value={i.installationId}>
                          {i.accountLogin} ({i.accountType})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="repo">Repository</Label>
                    <select
                      id="repo"
                      value={repoFullName}
                      onChange={(e) => setRepoFullName(e.target.value)}
                      className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
                      required
                    >
                      <option value="">
                        {repos.length ? "Pick a repo…" : "Loading…"}
                      </option>
                      {repos.map((r) => (
                        <option key={r.id} value={r.fullName}>
                          {r.fullName}
                          {r.private ? " · private" : ""}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="branch">Branch</Label>
                      <select
                        id="branch"
                        value={branch}
                        onChange={(e) => setBranch(e.target.value)}
                        disabled={!branches.length}
                        className="h-10 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 text-sm"
                      >
                        {branches.map((b) => (
                          <option key={b.name} value={b.name}>
                            {b.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="rootDir">Root directory (optional)</Label>
                      <Input
                        id="rootDir"
                        value={rootDir}
                        onChange={(e) => setRootDir(e.target.value)}
                        placeholder="apps/api"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="build">Build command (optional)</Label>
                    <Input
                      id="build"
                      value={buildCommand}
                      onChange={(e) => setBuildCommand(e.target.value)}
                      placeholder="bun install && bun run build"
                    />
                  </div>
                </>
              )}
            </>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="script">Start script</Label>
            <Input
              id="script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              placeholder={
                source === "local" ? "index.js" : "dist/index.js"
              }
              required
            />
            <CardDescription>
              File to execute (passed to PM2). For GitHub apps the start script
              is invoked from the deployed checkout.
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
            <Button
              type="submit"
              disabled={
                submitting ||
                (source === "github" && (!repoFullName || !branch || !installationId))
              }
            >
              {submitting ? "Creating…" : "Create application"}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
