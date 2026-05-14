import type { AppStatus } from "@pmploy/shared";
import { cn } from "../../lib/cn";

const styles: Record<AppStatus, string> = {
  created: "border-neutral-700 text-neutral-300",
  deploying: "border-amber-600 text-amber-300",
  running: "border-emerald-600 text-emerald-300",
  degraded: "border-amber-600 text-amber-300",
  stopped: "border-neutral-600 text-neutral-400",
  errored: "border-red-600 text-red-300",
};

export function StatusPill({ status }: { status: AppStatus }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-xs uppercase tracking-wider",
        styles[status],
      )}
    >
      {status}
    </span>
  );
}
