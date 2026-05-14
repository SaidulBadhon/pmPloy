import { Link } from "react-router-dom";
import type { PublicService } from "@pmploy/shared";
import { Card, CardDescription, CardTitle } from "./ui/Card";
import { StatusPill } from "./ui/StatusPill";
import { bytes } from "../lib/format";
import { serviceAppStatus } from "../lib/serviceStatus";

export function ServicesCard({
  appId,
  services,
}: {
  appId: string;
  services: PublicService[];
}) {
  return (
    <Card>
      <CardTitle>Services</CardTitle>
      <CardDescription className="mt-1">
        Each service is a PM2 process declared in <code>ecosystem.config.cjs</code>.
        Click a service to view its logs and environment overrides.
      </CardDescription>

      <ul className="mt-4 divide-y divide-neutral-800">
        {services.length === 0 && (
          <li className="py-3 text-neutral-500">
            No services yet — deploy this app to see them.
          </li>
        )}
        {services.map((svc) => (
          <li key={svc.name}>
            <Link
              to={`/apps/${appId}/services/${encodeURIComponent(svc.name)}`}
              className="flex items-center gap-3 py-3 hover:opacity-80"
            >
              <StatusPill status={serviceAppStatus(svc)} />
              <span className="font-mono text-sm">{svc.name}</span>
              {svc.isPrimary && (
                <span className="rounded-full border border-neutral-700 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-neutral-400">
                  primary
                </span>
              )}
              <span className="font-mono text-xs text-neutral-500">
                {svc.port !== null ? `:${svc.port}` : "—"}
              </span>
              <span className="ml-auto flex gap-4 font-mono text-xs text-neutral-500">
                <span>cpu {svc.pm2 ? `${svc.pm2.cpu}%` : "—"}</span>
                <span>mem {svc.pm2 ? bytes(svc.pm2.memory) : "—"}</span>
              </span>
              <span className="text-neutral-500">→</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}
