import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { env } from "./env.ts";
import { connectDb, dbStatus } from "./db.ts";
import authRoutes from "./routes/auth.ts";
import teamsRoutes from "./routes/teams.ts";
import appsRoutes from "./routes/apps.ts";
import githubRoutes from "./routes/github.ts";
import githubCallbackRoutes from "./routes/githubCallback.ts";

const app = new Hono();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowMethods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.get("/", (c) => c.json({ name: "pmploy-api", version: "0.0.1" }));

app.get("/health", (c) =>
  c.json({
    status: "ok",
    db: dbStatus(),
    uptime: process.uptime(),
  }),
);

app.route("/auth", authRoutes);
app.route("/teams", teamsRoutes);
app.route("/", appsRoutes);
app.route("/", githubRoutes);
app.route("/", githubCallbackRoutes);

app.onError((err, c) => {
  console.error("[api] error:", err);
  return c.json({ error: "internal_error", message: err.message }, 500);
});

connectDb().catch((err) => {
  console.error("[db] connection failed:", err.message);
});

console.log(`[api] listening on http://${env.API_HOST}:${env.API_PORT}`);

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};
