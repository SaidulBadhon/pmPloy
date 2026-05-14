import { useEffect, useRef, useState } from "react";

type LogEvent = { stream: "stdout" | "stderr"; line: string };

export function ServiceLogStream({
  teamId,
  appId,
  serviceName,
}: {
  teamId: string;
  appId: string;
  serviceName: string;
}) {
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [connected, setConnected] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setEvents([]);
    const url = `/api/teams/${teamId}/apps/${appId}/services/${encodeURIComponent(
      serviceName,
    )}/logs`;
    const es = new EventSource(url, { withCredentials: true });

    const onMessage = (e: MessageEvent) => {
      try {
        const ev = JSON.parse(e.data) as LogEvent;
        setEvents((cur) => {
          const next = cur.length > 2000 ? cur.slice(-2000) : cur;
          return [...next, ev];
        });
      } catch {
        // ignore malformed
      }
    };
    es.onopen = () => setConnected(true);
    es.onmessage = onMessage;
    es.onerror = () => {
      setConnected(false);
      // EventSource auto-reconnects.
    };

    return () => {
      es.close();
      setConnected(false);
    };
  }, [teamId, appId, serviceName]);

  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [events, autoScroll]);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs text-neutral-500">
        <span className={connected ? "text-emerald-400" : "text-amber-400"}>
          {connected ? "● live" : "○ reconnecting"}
        </span>
        <label className="ml-auto flex items-center gap-1">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
          />
          Auto-scroll
        </label>
      </div>
      <div
        ref={ref}
        className="max-h-[32rem] overflow-y-auto rounded-md border border-neutral-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-neutral-200"
      >
        {events.length === 0 ? (
          <p className="text-neutral-500">Waiting for logs…</p>
        ) : (
          events.map((ev, i) => (
            <pre
              key={i}
              className={
                ev.stream === "stderr"
                  ? "whitespace-pre-wrap break-all text-red-300"
                  : "whitespace-pre-wrap break-all"
              }
            >
              {ev.line || " "}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}
