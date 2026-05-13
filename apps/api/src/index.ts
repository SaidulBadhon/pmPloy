import { Hono } from "hono";
import { env } from "./env.ts";
import { connectDb, dbStatus } from "./db.ts";

const app = new Hono();

app.get("/", (c) => c.json({ name: "pmploy-api", version: "0.0.1" }));

app.get("/health", (c) =>
  c.json({
    status: "ok",
    db: dbStatus(),
    uptime: process.uptime(),
  }),
);

connectDb().catch((err) => {
  console.error("[db] connection failed:", err.message);
});

console.log(`[api] listening on http://${env.API_HOST}:${env.API_PORT}`);

export default {
  port: env.API_PORT,
  hostname: env.API_HOST,
  fetch: app.fetch,
};
