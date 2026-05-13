import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Commit,
  PlatformCheckResult,
  PlatformInfo,
  PlatformStatus,
} from "@pmploy/shared";
import { api, ApiError } from "../lib/api";
import { Button } from "../components/ui/Button";
import { Card, CardDescription, CardTitle } from "../components/ui/Card";
import { LogViewer } from "../components/LogViewer";

export default function PlatformPage() {
  const [info, setInfo] = useState<PlatformInfo | null>(null);
  const [pending, setPending] = useState<Commit[] | null>(null);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [inProgress, setInProgress] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadInfo = useCallback(async () => {
    try {
      const i = await api<PlatformInfo>(`/platform/info`);
      setInfo(i);
    } catch (err) {
      setError(err instanceof Error ? err.message : "info failed");
    }
  }, []);

  const pollStatus = useCallback(async () => {
    try {
      const s = await api<PlatformStatus>(`/platform/status`);
      setInProgress(s.inProgress);
      setLogLines(s.log.split("\n").filter(Boolean));
      if (!s.inProgress && pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
        // Re-fetch /platform/info: maybe the API just restarted with new code.
        // It might be down for a second or two — that's OK, the request just retries.
        setTimeout(loadInfo, 1500);
      }
    } catch {
      // ignore — API may be mid-restart
    }
  }, [loadInfo]);

  useEffect(() => {
    void loadInfo();
    void pollStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadInfo, pollStatus]);

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(pollStatus, 1500);
  }

  async function onCheck() {
    setBusy("check");
    setError(null);
    try {
      const r = await api<PlatformCheckResult>(`/platform/check`);
      setPending(r.pending);
      setInProgress(r.updateInProgress);
      if (r.updateInProgress) startPolling();
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) {
        setError("only platform admins can check for updates");
      } else {
        setError(err instanceof Error ? err.message : "check failed");
      }
    } finally {
      setBusy(null);
    }
  }

  async function onUpdate(target?: string) {
    const label = target ? "rollback" : "update";
    if (!confirm(
      target
        ? `Roll the platform back to ${target.slice(0, 7)}? The API will restart.`
        : "Update pmPloy to the latest commit on the tracking branch? The API will restart.",
    )) {
      return;
    }
    setBusy(label);
    setError(null);
    try {
      await api(`/platform/update`, {
        method: "POST",
        body: target ? { target } : {},
      });
      setInProgress(true);
      startPolling();
    } catch (err) {
      setError(err instanceof Error ? err.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  }

  if (!info) {
    return error ? (
      <p className="text-sm text-red-400">{error}</p>
    ) : (
      <p className="text-neutral-500">Loading…</p>
    );
  }

  if (!info.isPlatformAdmin) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Platform</h1>
        </header>
        <Card>
          <CardTitle>You're not a platform admin</CardTitle>
          <CardDescription className="mt-1">
            Platform updates can only be performed by the user whose email is
            in <code>PLATFORM_ADMINS</code> (or the first signup if that env
            var is unset).
          </CardDescription>
          <dl className="mt-4 grid grid-cols-[8rem,1fr] gap-y-2 text-sm">
            <dt className="text-neutral-500">branch</dt>
            <dd className="font-mono">{info.branch || "—"}</dd>
            <dt className="text-neutral-500">commit</dt>
            <dd className="font-mono">
              {info.head?.shortSha || "—"} · {info.head?.subject || "—"}
            </dd>
          </dl>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Platform</h1>
        <p className="text-neutral-400">
          Self-update pmPloy from its GitHub repo.
        </p>
      </header>

      {error && <p className="text-sm text-red-400">{error}</p>}

      <Card>
        <CardTitle>Current version</CardTitle>
        <dl className="mt-4 grid grid-cols-[8rem,1fr] gap-y-2 text-sm">
          <dt className="text-neutral-500">repo</dt>
          <dd className="break-all font-mono">{info.repoPath}</dd>
          <dt className="text-neutral-500">branch</dt>
          <dd className="font-mono">
            {info.branch || "—"}
            {!info.trackingUpstream && (
              <span className="ml-2 text-amber-300">(no upstream)</span>
            )}
          </dd>
          <dt className="text-neutral-500">commit</dt>
          <dd>
            <span className="font-mono">{info.head?.shortSha || "—"}</span>
            {info.head?.subject && (
              <span className="ml-2 text-neutral-300">{info.head.subject}</span>
            )}
          </dd>
          <dt className="text-neutral-500">working tree</dt>
          <dd className={info.dirty ? "text-amber-300" : "text-emerald-300"}>
            {info.dirty ? "dirty (local changes)" : "clean"}
          </dd>
        </dl>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Updates</CardTitle>
            <CardDescription className="mt-1">
              Fetch the remote and compare against the tracking branch.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={onCheck}
              disabled={busy !== null || inProgress}
            >
              {busy === "check" ? "Checking…" : "Check for updates"}
            </Button>
            {pending && pending.length > 0 && (
              <Button
                size="sm"
                onClick={() => onUpdate()}
                disabled={busy !== null || inProgress || info.dirty}
              >
                {busy === "update" ? "Updating…" : `Update (${pending.length})`}
              </Button>
            )}
          </div>
        </div>

        {pending && (
          <ul className="mt-4 divide-y divide-neutral-800">
            {pending.length === 0 && (
              <li className="py-3 text-neutral-500">Up to date.</li>
            )}
            {pending.map((c) => (
              <li key={c.sha} className="flex items-baseline gap-3 py-2 text-sm">
                <span className="font-mono text-xs text-neutral-500">
                  {c.shortSha}
                </span>
                <span className="flex-1">{c.subject}</span>
                <span className="text-xs text-neutral-500">{c.author}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(inProgress || logLines.length > 0) && (
        <Card>
          <CardTitle>
            {inProgress ? "Update in progress" : "Last update log"}
          </CardTitle>
          <CardDescription className="mt-1">
            The API will restart automatically when the build finishes. This
            page may briefly fail to refresh during the swap.
          </CardDescription>
          <div className="mt-3">
            <LogViewer lines={logLines} />
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Rollback</CardTitle>
        <CardDescription className="mt-1">
          Paste a git commit sha (or branch/tag) to check out instead of the
          latest. Useful for reverting a bad update.
        </CardDescription>
        <RollbackForm
          disabled={busy !== null || inProgress || info.dirty}
          onSubmit={(t) => onUpdate(t)}
        />
      </Card>
    </div>
  );
}

function RollbackForm({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (target: string) => void;
}) {
  const [target, setTarget] = useState("");
  return (
    <form
      className="mt-4 flex gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (target.trim()) onSubmit(target.trim());
      }}
    >
      <input
        value={target}
        onChange={(e) => setTarget(e.target.value)}
        placeholder="commit sha, branch, or tag"
        className="h-10 flex-1 rounded-md border border-neutral-700 bg-neutral-900 px-3 font-mono text-sm"
      />
      <Button type="submit" variant="danger" disabled={disabled || !target.trim()}>
        Roll back
      </Button>
    </form>
  );
}
