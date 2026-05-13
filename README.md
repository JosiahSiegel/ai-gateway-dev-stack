<div align="center">

# ai-gateway-dev-stack

**One-command local AI gateway for OpenCode, Claude Code, and any OpenAI-compatible client.**

[![CI](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml)
[![E2E](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml)
[![Docker Compose](https://img.shields.io/badge/docker--compose-ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Node.js](https://img.shields.io/badge/node-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Platforms](https://img.shields.io/badge/platforms-linux%20%7C%20macOS%20%7C%20WSL-blue)](#requirements)

Bundles [Manifest](https://manifest.build) (self-hosted gateway dashboard),
[provider-proxy](https://github.com/JosiahSiegel/provider-proxy) (header/body
patcher), and a [gethomepage.dev](https://gethomepage.dev) landing page into a
single clone-and-go dev environment.

</div>

---

## Contents

- [Why](#why)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Hook up clients](#hook-up-clients)
- [Configuring proxy routes](#configuring-proxy-routes)
- [Homepage dashboard](#homepage-dashboard)
- [Commands](#commands)
- [Environment variables](#environment-variables)
- [Updating](#updating)
- [Layout](#layout)
- [Requirements](#requirements)
- [Troubleshooting & FAQ](#troubleshooting--faq)

## Why

Routing local AI tools through a gateway gives you **logging, usage tracking,
rate limiting, and a single token** without each tool needing direct upstream
credentials. This stack pre-wires the three pieces so the only thing you do is
`./stack up`.

- **Zero npm/pip install** — proxy is single-file Node with no deps; everything else is Docker.
- **One `.env`** for the whole stack, with auto-generated secrets on first run.
- **Stack-internal services auto-appear** on the Homepage via Docker labels.
- **Compatible with existing `manifest-local` installs** — same Compose project name and Postgres volume.

## Architecture

```text
   request pipe ───────────────────────────────────────────────────────────►
┌─────────────────────┐   ┌────────────────────┐   ┌──────────────────────┐   ┌──────────────┐
│ OpenCode /          │──►│ Manifest           │──►│ provider-proxy       │──►│ upstream LLM │
│ Claude Code         │   │ (Docker :2099)     │   │ (host :9997)         │   │ providers    │
└─────────────────────┘   └────────────────────┘   └──────────────────────┘   └──────────────┘

  side-car (not on the request pipe):
    Homepage (Docker :2100)  — landing page tiles for the stack
    tailnet-poller           — optional, profile: tailnet
```

Manifest reaches the host proxy via `host.docker.internal:${PROXY_PORT}`. The
proxy defaults to binding `127.0.0.1` (not exposed to Docker networks or the
LAN). On Linux, where `host.docker.internal` resolves to the Docker bridge
rather than the loopback, `PROXY_BIND=0.0.0.0` is required so the container
can connect; the host firewall must then block the proxy port from outside
the box. See the "Linux note" under cloud deployment.

## Quickstart

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

## Cheap cloud deployment

The cheapest practical way to run this stack in the cloud is a single small VPS
with Docker Compose. A 2 vCPU / 4 GB RAM instance is enough for the stack plus
Postgres, and it keeps the only persistent state (`manifest_pgdata`) on one disk.

Recommended setup:

- Hetzner CX22 or similar small VPS
- Ubuntu 24.04
- Docker + Docker Compose plugin
- Tailscale for private access instead of public ingress

On the VM:

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

For a fresh VM, two equivalent one-shot bootstraps are included — both install
Docker, clone the repo, and run `./stack up`:

- `cloud-init.yaml` — paste into your provider's user-data field.
- `bootstrap-vps.sh` — `curl -fsSL .../bootstrap-vps.sh | sudo bash` on the VM.

If you want private access over tailnet, set the Tailscale env vars in `.env`
and run `./stack up --profile tailnet`.

### Hetzner specifics

1. Sign in at <https://console.hetzner.com/> → **Add Server**.
2. Image: **Ubuntu 24.04**. Type: **CX22** (x86) or **CAX11** (ARM, cheaper).
3. Paste `cloud-init.yaml` into the **Cloud config** field.
4. Create a **Firewall** that allows only **22/tcp** inbound. Do not expose
   ports `2099`, `2100`, or `9997` to the public internet.
5. SSH in once it boots, edit `.env`, then either `./stack restart` or, with
   Tailscale creds set, `./stack restart --profile tailnet`.

To make the VM itself a tailnet node (recommended — lets you drop public SSH):

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

### Other cheap VPS options

If Hetzner asks for ID verification or you want a different provider, these are
reasonable fallback choices:

- **Contabo VPS-S** — cheapest raw value; 4 vCPU / 8 GB RAM / 200 GB SSD. Card-only,
  cloud-init supported. Tradeoff: noisier storage and slower provisioning.
- **Oracle Cloud Always Free** — $0 if you can get capacity. Tradeoff: capacity
  is inconsistent and accounts can be reaped if idle.
- **DigitalOcean Basic** — simplest setup, but more expensive.
- **Vultr** — similar to DigitalOcean in price and experience.

The same `cloud-init.yaml` and `bootstrap-vps.sh` work for all of them.

### Linux note

Docker Desktop on macOS/Windows resolves `host.docker.internal` to the host
loopback automatically. Linux Docker does not — there, three things differ:

1. **`extra_hosts`** maps the name to the docker-bridge gateway. The parent
   `compose.yml` already sets this on the `manifest` service:

   ```yaml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

2. **`PROXY_BIND=0.0.0.0`** — the host proxy must accept connections from the
   bridge interface, not just loopback. Set this in `.env`:

   ```bash
   PROXY_BIND=0.0.0.0
   ```

   `./stack` warns at startup whenever `PROXY_BIND` is non-loopback so it's
   clear the host firewall is now the only barrier.

3. **Firewall** — block the proxy port from the public side, then allow it
   from the compose network's subnet. The compose network is a *custom*
   docker bridge (`br-<hash>`), **not** `docker0`, so `allow in on docker0`
   does not match. Allow by subnet instead, and insert the rule **above**
   the public deny — UFW evaluates rules top-to-bottom and the first match
   wins:

   ```bash
   SUBNET=$(docker network inspect mnfst_frontend \
     --format '{{(index .IPAM.Config 0).Subnet}}')

   sudo ufw deny ${PROXY_PORT:-9997}/tcp
   # If a stale rule already exists, delete it first so the new one lands
   # above the deny:
   sudo ufw delete allow from "$SUBNET" to any port ${PROXY_PORT:-9997} proto tcp 2>/dev/null

   # Find the line number of the public deny and insert above it
   sudo ufw status numbered | grep "${PROXY_PORT:-9997}/tcp"
   sudo ufw insert <N> allow from "$SUBNET" to any port ${PROXY_PORT:-9997} \
     proto tcp comment 'proxy: mnfst_frontend'
   sudo ufw reload
   ```

   Verify the final order — subnet allow ABOVE the public deny:

   ```
   [N]   ${PROXY_PORT}/tcp   ALLOW IN  <subnet>   # proxy: mnfst_frontend
   [N+1] ${PROXY_PORT}/tcp   DENY IN   Anywhere
   ```

Without (1), name resolution fails inside the container. Without (2), the
host refuses the TCP connect on the bridge. Without (3), the SYN is dropped
by UFW (manifests as `curl: (28) Connection timed out`, not "refused").
All three are needed on Linux; all three are already correct on Docker
Desktop.


`./stack up` will, in order:

1. Initialize the `manifest-local` and `provider-proxy` submodules if needed.
2. Create `.env` from `.env.example` on first run.
3. Auto-generate `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY`.
4. Seed `proxy.routes.json` from `proxy.routes.example.json` (`/openai` + `/kimi`).
5. Seed `homepage/.generated/services.yaml` from the template.
6. Bring up Manifest + Postgres + Homepage via Docker Compose.
7. Start `provider-proxy` on the host (binds `127.0.0.1:9997` by default; see
   `PROXY_BIND` for the Linux Docker case).

Then open:

| URL | Next step |
|---|---|
| <http://localhost:2099> | Finish Manifest's `/setup` wizard to create your admin account |
| <http://localhost:2100> | Homepage landing page for the stack |

In the Manifest dashboard, add a provider whose **Base URL** points at the proxy
from inside Docker:

```text
http://host.docker.internal:9997/openai/v1
http://host.docker.internal:9997/kimi/coding/v1
```

The path after the `pathPrefix` is forwarded upstream verbatim, so each provider's
"real" path lives here: `/openai/v1` -> `api.openai.com/v1`,
`/kimi/coding/v1` -> `api.kimi.com/coding/v1` (Kimi's coding-tuned endpoint).

> **Windows users**: use `.\stack.ps1 <command>`. It forwards into WSL or Git Bash automatically.

## Hook up clients

Both helpers emit a single parseable JSON document on **stdout**; prose
instructions go to **stderr**, so you can redirect cleanly.

### OpenCode

```bash
./stack opencode > ~/.config/opencode/opencode.json
```

Restart OpenCode and you're talking to Manifest through this stack.

### Claude Code

```bash
mkdir -p .claude
./stack claude | jq .settings       > .claude/settings.json
./stack claude | jq .settings_local > .claude/settings.local.json
# then edit .claude/settings.local.json and replace the token placeholder
```

`settings.local.json` holds your Manifest token — it's gitignored and should
stay local.

## Configuring proxy routes

Routes live in **`proxy.routes.json`** at the repo root (gitignored). On first
run, `./stack up` copies `proxy.routes.example.json` into place:

```json
[
  { "pathPrefix": "/kimi",   "host": "api.kimi.com", "headers": { "x-app": "cli" } },
  { "pathPrefix": "/openai", "host": "api.openai.com" }
]
```

Manifest then reaches the route at `http://host.docker.internal:9997/<pathPrefix>/<upstream-path>`
(e.g. `http://host.docker.internal:9997/kimi/coding/v1` for Kimi's coding endpoint,
or `http://host.docker.internal:9997/openai/v1` for OpenAI's standard one).
The proxy strips the `pathPrefix` before forwarding, so
`/kimi/coding/v1/chat/completions` upstream becomes
`https://api.kimi.com/coding/v1/chat/completions`.

**Supported fields per route:**

| Field | Required | Default | What it does |
|---|---|---|---|
| `pathPrefix` | ✓ | — | URL prefix to match, e.g. `/kimi`. First match wins. |
| `host` | ✓ | — | Upstream hostname. |
| `protocol` | | `https` | `https` or `http`. |
| `port` | | `443` / `80` | Upstream port. |
| `headers` | | — | Object of headers merged on top of `PROXY_USER_AGENT` + `PROXY_EXTRA_HEADERS` for this route only. |

**Edit → reload:**

1. Edit `proxy.routes.json`.
2. `./stack restart` (the script validates the JSON before starting the proxy
   and refuses to start if it's malformed).

**Single-target mode** — to bypass the routes file entirely, set
`PROXY_TARGET_HOST=<upstream>` (and optionally `PROXY_TARGET_PROTOCOL` /
`PROXY_TARGET_PORT`) in `.env`. The proxy forwards everything to that one
host. Useful for debugging.

For body-patching behavior (Gemini schema cleanup, content-encoding handling,
etc.) and the full proxy contract, see
[`provider-proxy/README.md`](provider-proxy/README.md).

## Homepage dashboard

A [gethomepage.dev](https://gethomepage.dev) container at <http://localhost:2100>
that lists everything in the stack. Stack-internal services (Manifest,
Homepage itself) appear automatically via Docker label discovery. Anything else
(host processes, external URLs) goes in `homepage/services.template.yaml`.

| File | Purpose |
|---|---|
| `homepage/config/settings.yaml`   | Title, theme, quicklaunch (press `/` to filter tiles) |
| `homepage/config/widgets.yaml`    | Info widgets (resources, datetime, …) |
| `homepage/config/bookmarks.yaml`  | Bookmark groups |
| `homepage/services.template.yaml` | Static service tiles (hand-edited source of truth) |
| `homepage/.generated/services.yaml` | Generated output (do not edit; gitignored) |

After editing, run `./stack restart homepage` to pick up changes.

### Optional: Tailnet integration

Set either an OAuth client (`TAILSCALE_OAUTH_CLIENT_ID` +
`TAILSCALE_OAUTH_CLIENT_SECRET`, recommended — non-expiring) or a long-lived
API key (`TAILSCALE_API_KEY`), plus `TAILSCALE_TS_DOMAIN`, in `.env`. `./stack
up` then runs a `tailnet-poller` sidecar that rewrites
`homepage/.generated/services.yaml` every minute with live tiles for your
tailnet devices and any Tailscale VIP services.

OAuth client scopes (Tailscale admin → Settings → OAuth clients):

- `devices:core:read` — required, populates the **Tailnet** group.
- `services:read` — optional, populates the **Tailscale Services** group.

Without those vars the poller is skipped and Homepage shows the static template
+ Docker-discovered tiles.

## Commands

| Command | What it does |
|---|---|
| `./stack up` | Start the full stack |
| `./stack down` | Stop everything |
| `./stack restart` | Down + up (rebuilds host proxy too) |
| `./stack restart <svc>...` | Recreate specific compose services (re-reads labels + env) |
| `./stack status` | Show container + proxy state (`ps` is an alias) |
| `./stack logs` | Tail Manifest, Postgres, and proxy logs |
| `./stack pull` | Update submodules + Docker images |
| `./stack opencode` | Print an OpenCode config snippet (JSON on stdout) |
| `./stack claude` | Print Claude Code `.claude/*` settings (JSON on stdout) |

On Windows without WSL or Git Bash, use `.\stack.ps1 <command>` instead.

## Environment variables

All configuration lives in a single root `.env`. `./stack up` creates it from
`.env.example` and auto-generates the two required secrets. Routes are **not**
in `.env` — they live in `proxy.routes.json`.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `2099` | Manifest dashboard port |
| `BETTER_AUTH_URL` | `http://localhost:2099` | Public URL Manifest believes it is at |
| `BETTER_AUTH_SECRET` | _auto_ | Session signing secret (generated if blank) |
| `MANIFEST_ENCRYPTION_KEY` | _auto_ | At-rest encryption for stored provider credentials |
| `PROVIDER_TIMEOUT_MS` | `600000` | Manifest upstream timeout (raised for slow local models) |
| `PROXY_PORT` | `9997` | Host proxy port |
| `PROXY_BIND` | `127.0.0.1` | Host proxy bind address. Set to `0.0.0.0` on Linux when a Docker container must reach the proxy via `host.docker.internal`. |
| `PROXY_TARGET_HOST` | _unset_ | Single-target alternative to `proxy.routes.json` |
| `PROXY_USER_AGENT` | _set_ | Default UA injected on every upstream request |
| `PROXY_EXTRA_HEADERS` | _unset_ | JSON object of extra global headers |
| `PROXY_DEBUG`, `PROXY_DEBUG_BODY` | _unset_ | Verbose logging |
| `HOMEPAGE_PORT` | `2100` | Homepage dashboard port |
| `HOMEPAGE_ALLOWED_HOSTS` | `localhost:2100` | CSRF allow-list (add tailnet host here) |
| `TAILSCALE_OAUTH_CLIENT_ID` + `TAILSCALE_OAUTH_CLIENT_SECRET` _or_ `TAILSCALE_API_KEY` | _unset_ | Enables tailnet-poller sidecar |
| `TAILSCALE_TS_DOMAIN`, `TAILSCALE_TAILNET`, `TAILSCALE_TAG_FILTER`, `TAILSCALE_POLL_INTERVAL_MS` | _unset_ / `60000` | Tailnet poller tunables |
| `CLAUDE_CODE_MANIFEST_URL`, `CLAUDE_CODE_MODEL` | _derived_ | Used only by `./stack claude` output |

See `.env.example` for the full annotated list.

## Updating

```bash
./stack pull
./stack restart
```

Pulls the latest commits on each submodule's default branch, pulls the latest
Manifest Docker image, and restarts the stack.

## Layout

```text
ai-gateway-dev-stack/
├── manifest-local/             # submodule — Manifest + Postgres compose
├── provider-proxy/             # submodule — header/body patching proxy
├── homepage/                   # parent-owned — dashboard config + tailnet-poller
│   ├── config/                 # hand-edited yaml (mounted at /app/config)
│   ├── services.template.yaml  # source of truth for static service tiles
│   ├── .generated/             # generated services.yaml (gitignored)
│   └── tailnet-poller/         # optional sidecar (zero-dep Node script)
├── compose.yml                 # parent overrides (wires manifest, homepage, poller)
├── stack                       # bash orchestrator (the one command)
├── stack.ps1                   # PowerShell shim that delegates to bash/WSL
├── proxy.routes.example.json   # template for proxy routes
├── proxy.routes.json           # active routes (gitignored, seeded from example)
├── .env.example                # single source of truth for all config
└── .env                        # local config (gitignored)
```

Both submodules are independent repos — you can `cd` into either and work on it
directly. The parent repo only adds orchestration; it never modifies the
children.

### Compatibility with a previous standalone `manifest-local` install

If you'd already been running `manifest-local` on its own, this parent stack
reuses the same Docker Compose project name (`mnfst`) and Postgres volume name
(`manifest_pgdata`). Switching to `./stack up` adopts the existing containers
and database without migration.

## Requirements

- **Docker** (Docker Desktop with WSL integration on Windows is fine)
- **Node.js 18+** on the host (provider-proxy uses only built-in modules — no `npm install`)
- **Bash** (WSL, Git Bash, macOS, or Linux)

## Troubleshooting & FAQ

**Manifest can't reach the proxy.** From inside the Manifest container, the
proxy is at `host.docker.internal:${PROXY_PORT}`, **not** `localhost`. Make
sure your provider Base URL uses `host.docker.internal`, and that `./stack
status` reports `provider-proxy: running`.

**provider-proxy failed to start.** Check `.stack/proxy.log` for the actual
error. Common causes: port `9997` already taken, or `proxy.routes.json` is
malformed (`./stack` will refuse to start the proxy if so). Fix and run
`./stack restart`.

**Homepage shows no tiles.** Stack-internal tiles come from Docker labels in
`compose.yml` and require the Docker socket mount. If you've sandboxed Docker,
the homepage container won't see other containers. Static tiles go in
`homepage/services.template.yaml`; run `./stack restart homepage` after edits.

**Tailnet group never appears.** Confirm either OAuth (`TAILSCALE_OAUTH_CLIENT_ID`
\+ `TAILSCALE_OAUTH_CLIENT_SECRET`) or `TAILSCALE_API_KEY`, plus
`TAILSCALE_TS_DOMAIN`, are set in `.env`. `./stack status` should list a
`tailnet-poller` container. `docker logs tailnet-poller` shows API-call
results.

**Why does `provider-proxy` run on the host instead of in Docker?** It
defaults to binding `127.0.0.1` as defense-in-depth, and containerizing it
would force a Docker-network exposure it wasn't designed for. Running it as a
host process keeps the surface area minimal — Manifest reaches it via
`host.docker.internal`. On Linux, `PROXY_BIND=0.0.0.0` widens the bind so
that hop works (see the Linux note); the host firewall is then the only
public barrier.

**Can I run only Manifest, without the proxy?** Yes. Delete `proxy.routes.json`
and leave `PROXY_TARGET_HOST` blank in `.env` and the proxy is skipped.
Configure Manifest providers directly against upstream URLs.

**Where is data persisted?** Postgres data lives in the pinned `manifest_pgdata`
Docker volume. `./stack down` stops containers but never removes that volume.
