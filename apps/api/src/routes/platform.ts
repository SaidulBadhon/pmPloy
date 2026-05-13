import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { TriggerUpdateInputSchema } from "@pmploy/shared";
import { requireAuth, type AuthVars } from "../auth/rbac.ts";
import { isPlatformAdmin, requirePlatformAdmin } from "../auth/platformAdmin.ts";
import {
  fetchAndDiff,
  getPlatformInfo,
  isUpdateInProgress,
  readUpdateLog,
  startUpdate,
} from "../services/platform.ts";

const route = new Hono<{ Variables: AuthVars }>();

route.use("*", requireAuth);

// Anyone authenticated can see version info; isPlatformAdmin tells the UI
// whether to render the manage UI.
route.get("/platform/info", async (c) => {
  const user = c.get("user");
  const info = await getPlatformInfo();
  return c.json({
    ...info,
    isPlatformAdmin: await isPlatformAdmin(user.email),
  });
});

route.get("/platform/check", requirePlatformAdmin, async (c) => {
  try {
    const pending = await fetchAndDiff();
    return c.json({ pending, updateInProgress: isUpdateInProgress() });
  } catch (err) {
    return c.json(
      { error: "fetch_failed", message: (err as Error).message },
      502,
    );
  }
});

route.get("/platform/status", requirePlatformAdmin, (c) =>
  c.json({
    inProgress: isUpdateInProgress(),
    log: readUpdateLog(),
  }),
);

route.post(
  "/platform/update",
  requirePlatformAdmin,
  zValidator("json", TriggerUpdateInputSchema),
  async (c) => {
    const info = await getPlatformInfo();
    if (info.dirty) {
      return c.json(
        { error: "dirty_working_tree", message: "resolve local changes first" },
        409,
      );
    }
    if (isUpdateInProgress()) {
      return c.json(
        { error: "update_in_progress", message: "another update is already running" },
        409,
      );
    }
    const { target } = c.req.valid("json");
    if (!target && !info.trackingUpstream) {
      return c.json(
        {
          error: "no_upstream",
          message:
            "the local branch has no tracking branch; pass an explicit target sha to rollback",
        },
        400,
      );
    }
    try {
      await startUpdate(target);
      return c.json({ ok: true }, 202);
    } catch (err) {
      return c.json(
        { error: "update_failed_to_start", message: (err as Error).message },
        500,
      );
    }
  },
);

export default route;
