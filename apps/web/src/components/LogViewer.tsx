import { useEffect, useRef } from "react";

export function LogViewer({
  lines,
  autoScroll = true,
}: {
  lines: string[];
  autoScroll?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  return (
    <div
      ref={ref}
      className="max-h-96 overflow-y-auto rounded-md border border-neutral-800 bg-black/60 p-3 font-mono text-xs leading-relaxed text-neutral-200"
    >
      {lines.length === 0 ? (
        <p className="text-neutral-500">No logs yet.</p>
      ) : (
        lines.map((line, i) => (
          <pre key={i} className="whitespace-pre-wrap break-all">
            {line || " "}
          </pre>
        ))
      )}
    </div>
  );
}
