import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { GithubInstallation } from "@pmploy/shared";
import { useAuth } from "../stores/auth";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Input";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

export default function GithubSettingsPage() {
  const { teams, currentTeamId } = useAuth();
  const team = teams.find((t) => t.id === currentTeamId) ?? null;
  const canManage = team?.role === "owner" || team?.role === "admin";

  const [configured, setConfigured] = useState<boolean | null>(null);
  const [installations, setInstallations] = useState<GithubInstallation[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [manualId, setManualId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    if (!currentTeamId) return;
    setError(null);
    try {
      const status = await api<{ configured: boolean }>(
        `/teams/${currentTeamId}/github/status`,
      );
      setConfigured(status.configured);
      const data = await api<{ installations: GithubInstallation[] }>(
        `/teams/${currentTeamId}/github/installations`,
      );
      setInstallations(data.installations);
    } catch (err) {
      setError(err instanceof Error ? err.message : "load failed");
    }
  }, [currentTeamId]);

  useEffect(() => {
    setInstallations(null);
    setConfigured(null);
    void load();
  }, [load]);

  async function startInstall() {
    if (!currentTeamId) return;
    try {
      const { url } = await api<{ url: string }>(
        `/teams/${currentTeamId}/github/install-url`,
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "install url failed");
    }
  }

  async function onManualConnect(e: FormEvent) {
    e.preventDefault();
    if (!currentTeamId) return;
    const id = Number(manualId);
    if (!Number.isInteger(id) || id <= 0) {
      setError("invalid installation id");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api(`/teams/${currentTeamId}/github/installations`, {
        method: "POST",
        body: { installationId: id },
      });
      setManualId("");
      await load();
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError(err instanceof Error ? err.message : "connect failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function disconnect(installationId: number) {
    if (!currentTeamId) return;
    if (!confirm("Disconnect this GitHub installation from the team?")) return;
    try {
      await api(
        `/teams/${currentTeamId}/github/installations/${installationId}`,
        { method: "DELETE" },
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "disconnect failed");
    }
  }

  if (!team) return <p className="text-neutral-400">No team selected.</p>;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">GitHub</h1>
        <p className="text-neutral-400">
          Connect a GitHub App installation so pmPloy can pull from your repos.
        </p>
      </header>

      {configured === false && (
        <Card>
          <CardTitle>GitHub App not configured</CardTitle>
          <CardDescription className="mt-1">
            A platform admin must register a GitHub App for this pmPloy instance
            before teams can connect repos. See{" "}
            <a className="underline" href="/settings/platform/github">
              Platform · GitHub
            </a>.
          </CardDescription>
        </Card>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardTitle>Installations</CardTitle>
        <CardDescription className="mt-1">
          {installations === null
            ? "Loading…"
            : installations.length === 0
              ? "No installations connected yet."
              : "Repos accessible from any of these installations can be deployed by this team."}
        </CardDescription>

        {installations && installations.length > 0 && (
          <ul className="mt-4 divide-y divide-neutral-800">
            {installations.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3">
                {i.avatarUrl && (
                  <img
                    src={i.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full"
                  />
                )}
                <div className="flex-1">
                  <p className="font-medium">{i.accountLogin}</p>
                  <p className="text-xs text-neutral-500">
                    {i.accountType} · installation #{i.installationId}
                  </p>
                </div>
                {canManage && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => disconnect(i.installationId)}
                  >
                    Disconnect
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canManage && configured !== false && (
        <Card>
          <CardTitle>Connect a new installation</CardTitle>
          <CardDescription className="mt-1">
            Install the GitHub App into your user or organisation, then return
            here. If the auto-redirect doesn't bring you back, paste the
            installation id manually.
          </CardDescription>

          <div className="mt-4 flex gap-3">
            <Button onClick={startInstall}>Install on GitHub</Button>
          </div>

          <form onSubmit={onManualConnect} className="mt-6 flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="installation-id">Installation id</Label>
              <Input
                id="installation-id"
                value={manualId}
                onChange={(e) => setManualId(e.target.value)}
                placeholder="e.g. 12345678"
              />
            </div>
            <Button type="submit" disabled={submitting || !manualId}>
              {submitting ? "Connecting…" : "Connect manually"}
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
