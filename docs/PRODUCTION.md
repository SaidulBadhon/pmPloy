# Deploying pmPloy in Production

This guide walks you through running pmPloy on a real server end-to-end, with
sensible defaults for security, persistence, and uptime. It assumes a single
fresh Linux VPS — the same box hosts pmPloy *and* the user apps it deploys.

> **Time budget**: ~30 minutes the first time. After that, deploys are
> push-button.

---

## Table of contents

1. [Target environment](#1-target-environment)
2. [DNS](#2-dns)
3. [Architecture overview](#3-architecture-overview)
4. [System bootstrap](#4-system-bootstrap)
5. [Install pmPloy](#5-install-pmploy)
6. [Register the GitHub App](#6-register-the-github-app)
7. [Run as a systemd service](#7-run-as-a-systemd-service)
8. [Caddyfile](#8-caddyfile)
9. [MongoDB hardening](#9-mongodb-hardening)
10. [Backups](#10-backups)
11. [Log rotation](#11-log-rotation)
12. [Upgrades](#12-upgrades)
13. [Health checks and monitoring](#13-health-checks-and-monitoring)
14. [Troubleshooting](#14-troubleshooting)
15. [Security checklist](#15-security-checklist)

---

## 1. Target environment

| Requirement     | Recommended                                       |
|-----------------|---------------------------------------------------|
| OS              | Ubuntu 22.04 LTS or 24.04 LTS (or Debian 12)      |
| CPU             | 2 vCPU (build steps are the bottleneck)           |
| RAM             | 2 GB minimum, 4 GB+ if you build many apps in parallel |
| Disk            | 20 GB SSD; each deployment keeps the 3 most recent checkouts |
| Network ports   | inbound 22 (SSH), 80, 443 — everything else firewalled  |

You also need:

- A domain you control (`example.com`).
- The ability to add `A` records pointing at the server.
- A GitHub account or org you can register apps under.

---

## 2. DNS

Before anything else, point DNS at the server. Two records:

| Type | Name                | Value             | Purpose                          |
|------|---------------------|-------------------|----------------------------------|
| A    | `pmploy.example.com` | server's public IP | pmPloy's own web UI + API       |
| A    | `*.apps.example.com` | server's public IP | wildcard for user app domains    |

The wildcard is optional but means each new app gets a working subdomain
immediately. Otherwise add per-app `A` records as you go.

---

## 3. Architecture overview

```
                  Internet
                     │
                  :80/:443
                     │
              ┌──────▼──────┐
              │    Caddy    │  ← terminates TLS, automatic Let's Encrypt
              └──────┬──────┘
            ┌────────┴────────────────────────┐
            │                                 │
   pmploy.example.com               <user>.example.com / custom domains
            │                                 │
            ▼                                 ▼
   ┌────────────────┐                ┌────────────────┐
   │   pmPloy API   │                │  PM2 process   │
   │  (Bun + Hono)  │◄──programmatic─┤    (user app)  │
   │   :4000 local  │      PM2       │  ephemeral port │
   └────────┬───────┘                └────────────────┘
            │
            ▼
   ┌────────────────┐
   │   MongoDB      │  ← bound to 127.0.0.1 only
   └────────────────┘
```

Everything except Caddy listens on `127.0.0.1`. Caddy's admin API also stays on
`127.0.0.1:2019` (default).

---

## 4. System bootstrap

SSH into the box as root (or via `sudo`). The commands below are tested on
Ubuntu 24.04 LTS.

### 4.1 Create a dedicated user

Run user apps and pmPloy under a non-root account:

```bash
adduser --disabled-password --gecos "" pmploy
usermod -aG sudo pmploy           # temporarily for setup; remove later if you like
```

Switch to that user for the rest of this section:

```bash
su - pmploy
```

### 4.2 Install Bun

```bash
curl -fsSL https://bun.sh/install | bash
echo 'export PATH="$HOME/.bun/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
bun --version    # expect >= 1.3
```

### 4.3 Install Node + PM2

PM2's daemon needs a real Node:

```bash
# As root (or with sudo) — back out of the pmploy shell first:
exit
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs git build-essential

# As pmploy:
su - pmploy
npm install -g pm2
pm2 startup systemd -u pmploy --hp /home/pmploy   # prints a command to run as root
exit
# Run the systemctl enable command pm2 just printed (as root).
```

Verify PM2 is alive across reboots:

```bash
systemctl status pm2-pmploy
```

### 4.4 Install MongoDB

```bash
# As root
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc \
  | gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor
echo "deb [arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg] \
  https://repo.mongodb.org/apt/ubuntu noble/mongodb-org/7.0 multiverse" \
  > /etc/apt/sources.list.d/mongodb-org-7.0.list
apt update
apt install -y mongodb-org
systemctl enable --now mongod
```

By default MongoDB on Ubuntu binds to `127.0.0.1` only. Verify:

```bash
ss -ltn | grep 27017     # expect 127.0.0.1:27017, not 0.0.0.0
```

### 4.5 Install Caddy

```bash
# As root
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
  | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
  > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

We'll write the Caddyfile in [section 8](#8-caddyfile).

### 4.6 Firewall

```bash
# As root
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
ufw status
```

---

## 5. Install pmPloy

As the `pmploy` user:

```bash
cd ~
git clone https://github.com/SaidulBadhon/pmPloy.git
cd pmPloy
./scripts/setup.sh    # generates .env with random JWT_SECRET + ENV_ENCRYPTION_KEY
```

Open `.env` and adjust:

```dotenv
NODE_ENV=production
API_HOST=127.0.0.1
API_PORT=4000

MONGO_URI=mongodb://127.0.0.1:27017/pmploy
JWT_SECRET=<keep the generated value>
ENV_ENCRYPTION_KEY=<keep the generated base64 value — losing this loses your env vars>

CADDY_ADMIN_URL=http://127.0.0.1:2019

# GitHub fields are filled in section 6
GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY=
GITHUB_WEBHOOK_SECRET=

PMPLOY_DATA_DIR=/home/pmploy/pmPloy-data
PMPLOY_REPO_PATH=/home/pmploy/pmPloy

# Operators who can run platform updates from the UI. If empty, the first
# user to sign up is treated as the platform admin (typical for a personal box).
PLATFORM_ADMINS=you@example.com
```

> **Back up the secrets.** Stash `JWT_SECRET` and especially `ENV_ENCRYPTION_KEY`
> in your password manager. If you lose `ENV_ENCRYPTION_KEY`, every encrypted
> environment variable becomes unrecoverable.

Build the frontend bundle once for production serving:

```bash
bun install
bun --filter @pmploy/web run build
```

Serving the static bundle through Caddy is covered in section 8.

---

## 6. Register the GitHub App

> Skip this section if you only deploy local-script apps. Real GitHub deploys
> need the App.

1. Go to <https://github.com/settings/apps/new> (or your org's `Settings → Developer settings → GitHub Apps → New GitHub App`).
2. Fill in the form:

   | Field                          | Value                                                       |
   |--------------------------------|-------------------------------------------------------------|
   | GitHub App name                | `pmPloy` (or anything unique)                               |
   | Homepage URL                   | `https://pmploy.example.com`                                 |
   | Callback URL                   | `https://pmploy.example.com/github/callback`                |
   | Setup URL (optional, post inst) | `https://pmploy.example.com/settings/github`                 |
   | Webhook                        | Active ✓                                                    |
   | Webhook URL                    | `https://pmploy.example.com/webhooks/github`                |
   | Webhook secret                 | Generate one (e.g. `openssl rand -hex 32`) and save it      |

3. **Permissions** (Repository permissions):

   | Permission   | Access       |
   |--------------|--------------|
   | Contents     | **Read-only**|
   | Metadata     | Read-only (auto) |
   | Webhooks     | Read & Write |
   | Pull requests| (optional) Read-only — if you want PR-triggered preview deploys later |

4. **Subscribe to events**: ✓ `Push`. ✓ `Installation` is helpful for diagnostics.
5. Where can this GitHub App be installed? **Any account** (or restrict to your org).
6. **Create** the app.
7. On the App's page, scroll to **Private keys** → **Generate a private key**.
   Download the `.pem`.
8. Note the **App ID** at the top of the App settings page.
9. Note the **Slug** from the App URL (`/settings/apps/<slug>`).

Now fill in pmPloy's `.env`:

```bash
# As pmploy user, in ~/pmPloy
APP_ID=<the App ID>
SLUG=<the slug>
WEBHOOK_SECRET=<the secret you generated above>

# Convert the PEM to a single-line value (newlines → \n)
PEM_ONE_LINE=$(awk 'NF {sub(/\r/, ""); printf "%s\\n", $0}' /path/to/downloaded.pem)

cat >> .env <<EOF
GITHUB_APP_ID=$APP_ID
GITHUB_APP_SLUG=$SLUG
GITHUB_APP_PRIVATE_KEY=$PEM_ONE_LINE
GITHUB_WEBHOOK_SECRET=$WEBHOOK_SECRET
EOF
```

(The original `.env` was written by `setup.sh` with empty placeholders for these
keys; the snippet above appends production values. Trim any older empty lines
afterward if you're tidy.)

---

## 7. Run as a systemd service

The pmPloy API should run under systemd so it restarts on crash and at boot.

Create `/etc/systemd/system/pmploy-api.service` (as root):

```ini
[Unit]
Description=pmPloy API
After=network-online.target mongod.service
Wants=network-online.target

[Service]
Type=simple
User=pmploy
Group=pmploy
WorkingDirectory=/home/pmploy/pmPloy
EnvironmentFile=/home/pmploy/pmPloy/.env
ExecStart=/home/pmploy/.bun/bin/bun run apps/api/src/index.ts
Restart=on-failure
RestartSec=3
StandardOutput=journal
StandardError=journal

# Hardening
NoNewPrivileges=yes
ProtectSystem=full
ProtectHome=read-only
PrivateTmp=yes
ReadWritePaths=/home/pmploy/pmPloy /home/pmploy/pmPloy-data

[Install]
WantedBy=multi-user.target
```

Enable + start it:

```bash
systemctl daemon-reload
systemctl enable --now pmploy-api
systemctl status pmploy-api
journalctl -u pmploy-api -f      # tail logs
```

> **Why systemd for the API but PM2 for user apps?** The API is one Bun process
> we want supervised by the OS. User apps are managed by PM2 (which is itself
> supervised by `pm2-pmploy.service` from section 4.3). So you end up with two
> supervisors: systemd watches one Bun + one PM2 daemon; PM2 watches every user
> app.

---

## 8. Caddyfile

Caddy fronts the entire system: it terminates TLS for the pmPloy panel itself
*and* for every user app whose domain you attach later. Replace
`/etc/caddy/Caddyfile` with:

```caddyfile
{
    # Admin API stays on localhost — pmPloy needs it; nobody else does.
    admin localhost:2019

    # Let's Encrypt account email
    email you@example.com
}

# --- pmPloy panel ---
pmploy.example.com {
    encode zstd gzip

    # Serve the built React SPA
    root * /home/pmploy/pmPloy/apps/web/dist
    file_server

    # Proxy API + webhooks to the Bun process
    @api path /auth/* /teams/* /apps/* /caddy/* /env/* /github/* /webhooks/* /health /
    handle @api {
        reverse_proxy 127.0.0.1:4000 {
            flush_interval -1     # important for SSE log streaming
        }
    }

    # SPA fallback: anything else returns index.html so client-side routing works
    @notfile {
        not file
        not path /auth/* /teams/* /apps/* /caddy/* /env/* /github/* /webhooks/* /health
    }
    rewrite @notfile /index.html
}
```

> **`flush_interval -1`** is important: it tells Caddy to stream upstream
> responses byte-by-byte. Without it, the live deployment log SSE stream gets
> buffered and the UI feels broken.

Reload Caddy:

```bash
systemctl reload caddy
```

Visit `https://pmploy.example.com`. Caddy negotiates a Let's Encrypt cert on
first request (DNS must already point at this server). Sign up — the first user
becomes the team owner.

User-app domains are **not** added to this Caddyfile manually. When you attach
a domain in the UI, pmPloy PATCHes the admin API to add a new route, and Caddy
picks up the cert automatically. You can verify with:

```bash
curl -s http://127.0.0.1:2019/config/apps/http/servers/srv0/routes | jq '.'
```

---

## 9. MongoDB hardening

The Ubuntu MongoDB package already binds to `127.0.0.1` only — that alone is
sufficient if the server is single-tenant. For an extra belt-and-braces:

### Enable authentication

```bash
mongosh
```

```js
use admin
db.createUser({
  user: "root",
  pwd:  "REPLACE_ME_LONG_RANDOM",
  roles: [{ role: "root", db: "admin" }]
})
exit
```

Edit `/etc/mongod.conf`:

```yaml
security:
  authorization: enabled
```

Restart and create the pmPloy user:

```bash
systemctl restart mongod
mongosh --authenticationDatabase admin -u root -p
```

```js
use pmploy
db.createUser({
  user: "pmploy",
  pwd:  "REPLACE_ME_ANOTHER_LONG_RANDOM",
  roles: [{ role: "readWrite", db: "pmploy" }]
})
exit
```

Update `.env`:

```dotenv
MONGO_URI=mongodb://pmploy:REPLACE_ME_ANOTHER_LONG_RANDOM@127.0.0.1:27017/pmploy?authSource=pmploy
```

Restart pmPloy:

```bash
systemctl restart pmploy-api
```

---

## 10. Backups

What needs backing up:

| Path                          | What's in it                                  |
|-------------------------------|-----------------------------------------------|
| MongoDB `pmploy` database     | Users, teams, apps, deployments, env vars, audit |
| `/home/pmploy/pmPloy/.env`    | `JWT_SECRET`, `ENV_ENCRYPTION_KEY`, GitHub App keys |
| `/home/pmploy/pmPloy-data`    | Cached git checkouts (regeneratable, skip if you want) |

Daily mongodump cron, retained for 14 days:

```bash
# As root
cat > /etc/cron.daily/pmploy-backup <<'EOF'
#!/usr/bin/env bash
set -e
ts=$(date +%F)
out=/var/backups/pmploy/$ts
mkdir -p "$out"
mongodump --uri="$(awk -F= '/^MONGO_URI=/{print $2}' /home/pmploy/pmPloy/.env)" --out "$out"
cp /home/pmploy/pmPloy/.env "$out/dotenv"
chmod 600 "$out/dotenv"
find /var/backups/pmploy -maxdepth 1 -mtime +14 -exec rm -rf {} +
EOF
chmod +x /etc/cron.daily/pmploy-backup
```

For off-site storage, push `/var/backups/pmploy` to S3/Backblaze with `restic`
or `rclone` — that's outside pmPloy's scope but standard fare.

### Restore drill

To restore on a fresh box:

```bash
# 1. Get pmPloy installed up through section 5 (don't start the service yet).
# 2. Copy the backed-up .env into place (it has the encryption key).
# 3. Restore Mongo:
mongorestore --uri="mongodb://pmploy:…@127.0.0.1:27017/pmploy?authSource=pmploy" \
  /path/to/backup/<date>/pmploy
# 4. systemctl start pmploy-api
```

Run a restore drill to a staging box at least once before you trust the backup.

---

## 11. Log rotation

### API logs

The API writes to journald via systemd; journald rotates by default. Tune in
`/etc/systemd/journald.conf` if you want a hard cap:

```ini
SystemMaxUse=2G
```

### User-app logs (PM2)

PM2's stdout/stderr piles up under `~/.pm2/logs/` by default. Install the
log-rotate module:

```bash
su - pmploy
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 50M
pm2 set pm2-logrotate:retain 10
pm2 set pm2-logrotate:compress true
```

---

## 12. Upgrades

You have two paths: **in-product** (point-and-click from the UI) or **manual**
(SSH in and run git yourself). They produce identical results — the in-product
flow just runs the same `scripts/update.sh` for you.

### 12.1 In-product self-update

The **Platform** page (in the top nav) lets a designated *platform admin* fetch
the latest commits, see what's pending, and update with one click. The API
restarts itself when the build succeeds; user-app PM2 processes keep running
through it.

**Who can do this:**

- If you set `PLATFORM_ADMINS=alice@example.com,bob@example.com` in `.env`,
  those users see the management UI.
- If you leave `PLATFORM_ADMINS` empty, the user with the earliest signup
  date is treated as the platform admin (the operator, typically).

**How it works under the hood:**

1. The UI calls `POST /platform/update`.
2. The API spawns `scripts/update.sh` fully detached via `setsid` so it
   survives the API restart.
3. The script: acquires a PID lockfile under `$PMPLOY_DATA_DIR/update.pid`,
   refuses to run if the working tree is dirty, fetches origin, fast-forwards
   the current branch (or `git checkout`s an explicit target sha for rollback),
   runs `bun install`, builds the web bundle, and sends `SIGTERM` to the API
   PID it reads from `$PMPLOY_DATA_DIR/api.pid`.
4. systemd's `Restart=on-failure` brings the new code up.

**No sudo required** — the API and updater run as the same `pmploy` user, so
the script can signal the API directly without touching `systemctl`.

**Where to watch progress**: the Platform page polls every 1.5s and shows a
live tail of `$PMPLOY_DATA_DIR/update.log`. The page itself may briefly fail to
refresh during the API restart — that's expected; it recovers on its own.

**Safety guarantees:**

- A dirty working tree (anything you've hand-edited on the box) blocks the
  update. The page tells you so. Resolve it via SSH first.
- A second update can't start while one is in flight (PID lockfile).
- If `bun install` or the build fails, the script exits *before* signalling
  the API — your currently running pmPloy is untouched.

User-app processes keep running through a platform upgrade — only the API
restarts. They only restart when *you* hit Restart/Deploy in the UI.

### 12.2 Manual upgrade (SSH)

```bash
su - pmploy
cd ~/pmPloy
git fetch
git log --oneline ..@{u} | head    # see what's new
git pull
bun install
bun --filter @pmploy/web run build   # rebuild the SPA
exit
sudo systemctl restart pmploy-api
```

### 12.3 Rolling back the platform

**From the UI**: Platform → Rollback section → paste the previous commit sha
(or branch/tag) → Roll back. Same script, just with an explicit target.

**From SSH**:

```bash
cd ~/pmPloy
git log --oneline -10           # find the previous commit
git checkout <sha>
bun install
bun --filter @pmploy/web run build
sudo systemctl restart pmploy-api
```

### 12.4 Rolling back a deployed app

Use the **Redeploy** button on any past deployment row in the UI — pmPloy
re-clones at that commit, rebuilds, and swaps the PM2 process. No git surgery
needed.

---

## 13. Health checks and monitoring

The API exposes `GET /health` (no auth required), returning:

```json
{ "status": "ok", "db": "connected", "uptime": 3601.2 }
```

Wire it into your uptime monitor (UptimeRobot, BetterStack, etc.) pointed at
`https://pmploy.example.com/health`.

For user apps, the **App detail** page shows live CPU/memory and status.
External monitoring per user app is up to you — point your uptime monitor at
the user app's public domain.

---

## 14. Troubleshooting

| Symptom                                            | Likely cause                                                          | Fix                                                                                |
|----------------------------------------------------|-----------------------------------------------------------------------|------------------------------------------------------------------------------------|
| `db: disconnected` in `/health`                    | Mongo down or wrong `MONGO_URI`                                       | `systemctl status mongod`; `journalctl -u mongod`                                  |
| Login works but team page shows nothing            | Browser blocking cookies because cookie isn't `Secure`               | Make sure you set `NODE_ENV=production` and are visiting over HTTPS                |
| Deployment hangs at "▶ cloning …"                  | The deploy worker can't reach github.com (firewall, proxy)            | Test from the server: `curl -I https://github.com`                                 |
| Build fails: "install exited with code 1"          | Missing system dep (e.g. `python3` for `node-gyp`, `make`, etc.)      | `apt install` what the user app needs; re-trigger deploy                            |
| `pm2 process not online (status errored)`          | The app's start script crashed                                        | Check the build log; SSH in and `pm2 logs pmploy:<appId>`                          |
| Caddy SSL pending → error                          | DNS not pointing at the server, or rate limit, or port 80/443 blocked | `dig api.example.com`, `journalctl -u caddy`, retry after DNS propagates           |
| Webhook fires but no deploy                        | Signature secret mismatch                                             | `GITHUB_WEBHOOK_SECRET` in `.env` must match what's set in the GitHub App config   |
| "GitHub App not configured" banner                 | `.env` keys missing or API not restarted after editing                | Confirm all four `GITHUB_*` vars are set; `systemctl restart pmploy-api`           |
| "encryption_not_configured" when saving env var    | `ENV_ENCRYPTION_KEY` not a 32-byte base64 string                      | `openssl rand -base64 32`; set in `.env`; restart                                  |
| Live log doesn't stream (waits, then dumps at end) | Caddy buffering SSE                                                   | Confirm `flush_interval -1` on the reverse_proxy block                              |
| Two deploys racing for one app                     | Shouldn't happen — pmPloy serialises per app                          | If you see it, file a bug with the deployment ids                                  |

### Inspecting state

```bash
# API health
curl -s https://pmploy.example.com/health | jq

# What's running under PM2 right now
su - pmploy -c 'pm2 list'

# What routes Caddy has
curl -s http://127.0.0.1:2019/config/apps/http/servers/srv0/routes | jq '.[] | "@id" '

# Tail API logs
journalctl -u pmploy-api -f

# Tail a specific user app
su - pmploy -c 'pm2 logs pmploy:<appId> --lines 200'
```

---

## 15. Security checklist

Run through this list once before pointing real users at the box.

- [ ] OS is fully patched (`apt update && apt upgrade`)
- [ ] `ufw` is enabled and only 22/80/443 are open externally
- [ ] SSH uses key auth only (`PasswordAuthentication no` in `sshd_config`)
- [ ] The `pmploy` user has been removed from sudoers after setup is done
- [ ] MongoDB binds to `127.0.0.1` only **and** has auth enabled
- [ ] `JWT_SECRET` and `ENV_ENCRYPTION_KEY` are long, random, and **backed up off-box**
- [ ] `.env` is mode `600` and owned by `pmploy`: `chmod 600 /home/pmploy/pmPloy/.env`
- [ ] The GitHub App private key file has been deleted from the box after pasting it into `.env`
- [ ] `CADDY_ADMIN_URL` is `http://127.0.0.1:2019` — the admin API must never be exposed to the internet
- [ ] `NODE_ENV=production` so auth cookies are `Secure`
- [ ] Daily mongodump backups are running (check `/var/backups/pmploy/<today>`)
- [ ] Off-site backup copies the dump + `.env` somewhere safe
- [ ] Restore drill performed at least once on a throw-away box
- [ ] Uptime monitor pinging `/health` every minute
- [ ] PM2 log rotation configured
- [ ] You know how to reach the box on console if SSH is locked out (cloud provider rescue mode)

---

If anything in this guide is ambiguous on your distro/setup, please open an
issue — patches welcome.
