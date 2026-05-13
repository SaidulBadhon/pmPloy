import { useEffect, useState } from "react";

type Health = {
  status: string;
  db: string;
  uptime: number;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(setHealth)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-6 px-6">
      <header>
        <h1 className="text-4xl font-bold tracking-tight">pmPloy</h1>
        <p className="mt-2 text-neutral-400">
          A self-hosted PaaS for PM2 — git push to live URL.
        </p>
      </header>

      <section className="rounded-lg border border-neutral-800 bg-neutral-900/50 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-neutral-400">
          API health
        </h2>
        {error && <p className="mt-2 text-red-400">Error: {error}</p>}
        {health && (
          <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
            <div>
              <dt className="text-neutral-500">status</dt>
              <dd className="font-mono">{health.status}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">db</dt>
              <dd className="font-mono">{health.db}</dd>
            </div>
            <div>
              <dt className="text-neutral-500">uptime</dt>
              <dd className="font-mono">{health.uptime.toFixed(1)}s</dd>
            </div>
          </dl>
        )}
        {!health && !error && <p className="mt-2 text-neutral-500">Loading…</p>}
      </section>
    </main>
  );
}
