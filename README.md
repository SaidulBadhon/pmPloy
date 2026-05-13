# pmPloy

A self-hosted PaaS for **PM2** — a Dokploy-style web UI for deploying Node.js apps from GitHub directly to PM2 processes on your own server, with Caddy handling domains and automatic HTTPS.

## Why

Dokploy / Coolify / CapRover all assume Docker. pmPloy is for teams that already run their fleet on **PM2** and want the same "git push → live URL" UX without containerizing every app.

## Stack

- **Runtime**: [Bun](https://bun.com)
- **Backend**: [Hono](https://hono.dev) + [Mongoose](https://mongoosejs.com) (MongoDB)
- **Frontend**: [Vite](https://vite.dev) + React + TypeScript + [shadcn/ui](https://ui.shadcn.com)
- **Process manager**: [PM2](https://pm2.keymetrics.io) (programmatic API)
- **Reverse proxy / TLS**: [Caddy](https://caddyserver.com) (Admin API, automatic Let's Encrypt)
- **Auth**: JWT with full RBAC + teams

## Repo Layout

```
pmploy/
├── apps/
│   ├── api/        # Bun + Hono backend
│   └── web/        # Vite + React frontend
└── packages/
    └── shared/     # Zod schemas + shared types
```

## Prerequisites

- Bun ≥ 1.3
- MongoDB running locally (`mongod`) or a connection URI
- PM2 daemon running on the same host (`pm2 ping`)
- Caddy running with the Admin API enabled (default `:2019`)

## Quick Start

```bash
cp .env.example .env
bun install
bun run dev
```

This starts the API on `http://localhost:4000` and the web UI on `http://localhost:5173`.

## Status

Early development. See `/root/.claude/plans/do-you-know-about-structured-rivest.md` for the architecture plan and milestone checklist.
