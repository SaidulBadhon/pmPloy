import { useEffect, useState } from "react";
import type { PublicAuditEntry } from "@pmploy/shared";
import { api } from "../lib/api";
import { Card, CardDescription, CardTitle } from "./ui/Card";

export function ActivityCard({ teamId }: { teamId: string }) {
  const [entries, setEntries] = useState<PublicAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEntries(null);
    api<{ entries: PublicAuditEntry[] }>(`/teams/${teamId}/audit?limit=50`)
      .then((d) => setEntries(d.entries))
      .catch((e: Error) => setError(e.message));
  }, [teamId]);

  return (
    <Card>
      <CardTitle>Activity</CardTitle>
      <CardDescription className="mt-1">
        Recent changes by team members.
      </CardDescription>
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <ul className="mt-4 divide-y divide-neutral-800">
        {entries === null && <li className="py-3 text-neutral-500">Loading…</li>}
        {entries && entries.length === 0 && (
          <li className="py-3 text-neutral-500">No activity yet.</li>
        )}
        {entries?.map((e) => (
          <li key={e.id} className="flex flex-wrap items-baseline gap-2 py-2 text-sm">
            <span className="font-mono text-xs text-neutral-500">
              {new Date(e.createdAt).toLocaleString()}
            </span>
            <span className="text-neutral-300">{e.userEmail || "system"}</span>
            <span className="font-mono text-xs uppercase tracking-wider text-neutral-400">
              {e.action}
            </span>
            {e.targetLabel && (
              <span className="font-mono text-xs text-neutral-300">
                {e.targetLabel}
              </span>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
