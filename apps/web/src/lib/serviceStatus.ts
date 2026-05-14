import type { PublicService } from "@pmploy/shared";

export function serviceAppStatus(
  svc: PublicService,
): "running" | "stopped" | "errored" | "deploying" {
  const s = svc.pm2?.status;
  if (s === "online") return "running";
  if (s === "errored") return "errored";
  if (s === "launching") return "deploying";
  return "stopped";
}
