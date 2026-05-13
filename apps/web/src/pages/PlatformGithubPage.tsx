import { useCallback, useEffect, useState } from "react";
import type {
  GithubAppStatus,
  RegisterManifestResponse,
} from "@pmploy/shared";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";

export default function PlatformGithubPage() {
  const [status, setStatus] = useState<GithubAppStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await api<GithubAppStatus>(`/platform/github`);
      setStatus(s);
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("Only platform admins can manage the GitHub App.");
      } else {
        setError(err instanceof Error ? err.message : "load failed");
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function startRegister() {
    setBusy(true);
    setError(null);
    try {
      const r = await api<RegisterManifestResponse>(`/platform/github/manifest`, {
        method: "POST",
      });
      submitManifestForm(r);
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : "register failed");
    }
  }

  async function disconnect() {
    if (
      !confirm(
        "Disconnect the GitHub App? Existing webhooks will stop being accepted and every team will need to re-install once a new App is registered.",
      )
    )
      return;
    setBusy(true);
    try {
      await api(`/platform/github`, { method: "DELETE" });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "disconnect failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Platform · GitHub</h1>
        <p className="text-neutral-400">
          Register a GitHub App for this pmPloy instance. Teams can then install
          it on their orgs to connect repos.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {status === null && !error ? (
        <p className="text-neutral-500">Loading…</p>
      ) : status === null ? null : status.configured ? (
        <Card>
          <CardTitle>GitHub App configured</CardTitle>
          <CardDescription className="mt-1">
            <strong>{status.slug}</strong> (id {status.appId}) ·
            source: <code>{status.source}</code>
            {status.htmlUrl && (
              <>
                {" · "}
                <a className="underline" href={status.htmlUrl} target="_blank" rel="noreferrer">
                  Open on GitHub
                </a>
              </>
            )}
          </CardDescription>
          {status.source === "database" && (
            <div className="mt-4">
              <Button variant="danger" onClick={disconnect} disabled={busy}>
                Disconnect
              </Button>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardTitle>No GitHub App registered</CardTitle>
          <CardDescription className="mt-1">
            Click below to register one. You'll be redirected to GitHub to confirm
            the app's permissions and webhook URL.
          </CardDescription>
          <div className="mt-4">
            <Button onClick={startRegister} disabled={busy}>
              {busy ? "Preparing…" : "Register GitHub App"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function submitManifestForm(r: RegisterManifestResponse) {
  const form = document.createElement("form");
  form.method = "POST";
  // GitHub requires the state in the URL query, not the form body.
  const url = new URL(r.action);
  url.searchParams.set("state", r.state);
  form.action = url.toString();

  const input = document.createElement("input");
  input.type = "hidden";
  input.name = "manifest";
  input.value = r.manifest;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();
}
