# pmPloy

A self-hosted PaaS for **PM2** — a Dokploy-style web UI for deploying Node.js
apps from GitHub directly to PM2 processes on your own server, with Caddy
handling domains and automatic HTTPS.

## Why

Dokploy / Coolify / CapRover all assume Docker. pmPloy is for teams that
already run their fleet on **PM2** and want the same "git push → live URL" UX
without containerising every app.

## Features

- **Multi-tenant** — users, teams, and full RBAC (owner / admin / member / viewer)
- **GitHub integration** — connect a GitHub App once, deploy any repo it can see
- **CI/CD on push** — webhook fans out to every matching app+branch and queues a deploy
- **Live build logs** — server-sent-events stream `git clone` + install + build output to the UI
- **PM2 under the hood** — programmatic API for start/stop/restart, fork or cluster mode
- **Caddy reverse proxy** — point a domain at pmPloy and Caddy negotiates Let's Encrypt automatically
- **Encrypted env vars** — AES-256-GCM at rest, injected on PM2 start
- **Metrics** — live CPU and memory time series on each app
- **Rollback** — redeploy any past commit with one click
- **Audit log** — track who deployed, who changed roles, who attached a domain

## Stack

- **Runtime**: [Bun](https://bun.com) 1.3+
- **Backend**: [Hono](https://hono.dev) + [Mongoose](https://mongoosejs.com) (MongoDB)
- **Frontend**: [Vite](https://vite.dev) + React + TypeScript + Tailwind
- **Process manager**: [PM2](https://pm2.keymetrics.io) (programmatic API)
- **Reverse proxy / TLS**: [Caddy](https://caddyserver.com) (Admin API)

## Repo layout

```
pmploy/
├── apps/
│   ├── api/        # Bun + Hono backend
│   └── web/        # Vite + React frontend
├── packages/
│   └── shared/     # Zod schemas + shared types
└── scripts/
    └── setup.sh    # one-shot environment bootstrap
```

## Prerequisites

| Tool     | Version | Why                                                |
|----------|---------|----------------------------------------------------|
| Bun      | ≥ 1.3   | Runtime + package manager                          |
| MongoDB  | ≥ 6     | Application + audit + deployment storage           |
| PM2      | latest  | Process supervisor for user apps                   |
| Caddy    | ≥ 2.7   | Reverse proxy + automatic HTTPS                    |
| git      | any     | Used by the deploy worker to clone repos           |

Caddy must be running with the **admin API enabled** (default `:2019`). PM2's
daemon must be reachable to the API process (`pm2 ping` works).

## Quick start (single server)

```bash
git clone https://github.com/SaidulBadhon/pmPloy.git
cd pmPloy
./scripts/setup.sh        # prerequisite checks + .env with generated secrets
bun install
bun run dev               # API on :4000, web on :5173
```

Open <http://localhost:5173>, sign up, create a team.

For a real deployment with systemd, hardened Mongo, Caddy in front of the
panel, daily backups, and a security checklist, see
**[docs/PRODUCTION.md](docs/PRODUCTION.md)**.

### GitHub App (optional, required for repo-based deploys)

1. <https://github.com/settings/apps/new> — create a new App in your account or organisation.
2. Permissions: **Contents: Read**, **Metadata: Read**, **Webhooks: Read & Write**.
3. Subscribe to: `Push` events.
4. Webhook URL: `https://<your-pmploy-host>/webhooks/github`.
5. Save, generate a webhook secret, generate and download the private key.
6. Fill in `.env`:
   ```
   GITHUB_APP_ID=<numeric id>
   GITHUB_APP_SLUG=<slug>
   GITHUB_APP_PRIVATE_KEY=<contents of the .pem on a single line with \n separators>
   GITHUB_WEBHOOK_SECRET=<the secret you set>
   ```
7. Restart the API. Visit **Settings → GitHub** and click *Install on GitHub*.

### Caddy minimal config

`scripts/setup.sh` doesn't install Caddy. Once installed, run with at least:

```
{
  admin localhost:2019
  email you@example.com
}
```

pmPloy will PUT a default `:80`/`:443` server config into Caddy via the admin
API the first time you attach a domain.

## Configuration

All configuration is via environment variables — see `.env.example` for the
full list with comments. The most security-sensitive ones:

- `JWT_SECRET` — signs auth cookies. Any high-entropy string ≥ 16 chars.
- `ENV_ENCRYPTION_KEY` — 32-byte base64 key for env-var AES-256-GCM. Generate
  with `openssl rand -base64 32`. If unset, the env-var feature is disabled
  and a friendly banner is shown in the UI.

## Development

```bash
bun install            # workspace install
bun run dev            # runs apps/api and apps/web concurrently
bun --filter '*' test  # all unit tests
bun --filter '*' typecheck
```

The Vite dev server proxies `/api/*` to the API on port 4000 (the prefix is
stripped before forwarding).

## Architecture

```
                ┌────────────────────────────────────────────┐
  Browser ─────►│  Vite + React SPA                          │
                └──────────────┬─────────────────────────────┘
                               │ REST + SSE
                ┌──────────────▼─────────────────────────────┐
                │  Bun + Hono API                            │
                │  ├─ Auth (JWT, RBAC)                       │
                │  ├─ Deploy worker (per-app queue)          │
                │  ├─ PM2 client (programmatic)              │
                │  ├─ Caddy client (Admin API :2019)         │
                │  └─ GitHub App + webhook receiver          │
                └─────┬─────────────────┬────────────────────┘
                      │                 │
              ┌───────▼──────┐   ┌──────▼────────┐
              │  MongoDB     │   │  PM2 daemon   │◄── user app processes
              └──────────────┘   └───────────────┘
                      ▲
                      │
              ┌───────┴──────┐
              │   Caddy      │◄── :80 / :443 → reverse_proxy → PM2 ports
              └──────────────┘
```

## License

MIT (pending — see commit history for now).
