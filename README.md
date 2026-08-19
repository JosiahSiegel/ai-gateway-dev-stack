<div align="center">

# ai-gateway-dev-stack

**One-command local AI gateway for OpenCode, Claude Code, and any OpenAI-compatible client.**

[![CI](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml)
[![E2E](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml)
[![Docker Compose](https://img.shields.io/badge/docker--compose-ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Platforms](https://img.shields.io/badge/platforms-linux%20%7C%20macOS%20%7C%20WSL-blue)](#requirements)

Bundles [Manifest](https://manifest.build) (self-hosted gateway dashboard),
[claude-proxy](https://github.com/JosiahSiegel/claude-proxy) (Claude Code OAuth
subscription proxy), and a [gethomepage.dev](https://gethomepage.dev) landing
page into a single clone-and-go dev environment.

</div>

---

## Contents

- [Why](#why)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Cheap cloud deployment](#cheap-cloud-deployment)
- [Hook up clients](#hook-up-clients)
- [Configuring Claude Code auth](#configuring-claude-code-auth)
- [Homepage dashboard](#homepage-dashboard)
- [Operational docs](#operational-docs)
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

- **Minimal host install** — only Docker and Bash. claude-proxy runs as a Docker compose service with no host-side Node or Python needed.
- **One `.env`** for the whole stack, with auto-generated secrets on first run.
- **Stack-internal services auto-appear** on the Homepage via Docker labels.
- **Compatible with existing `manifest-local` installs** — same Compose project name and Postgres volume.

## Architecture

```text
   request pipe ───────────────────────────────────────────────────────────►
┌─────────────────────┐   ┌────────────────────┐   ┌──────────────────────┐   ┌──────────────┐
│ OpenCode /          │──►│ Manifest           │──►│ claude-proxy         │──►│ Anthropic    │
│ Claude Code         │   │ (Docker :2099)     │   │ (Docker :8080,       │   │ Claude Code  │
│ (host CLI)          │   │                    │   │  in-network only)    │   │ OAuth        │
└─────────────────────┘   └────────────────────┘   └──────────────────────┘   └──────────────┘

  side-car (not on the request pipe):
    Homepage (Docker :2100)  — landing page tiles for the stack
    tailnet-poller           — optional, profile: tailnet
```

`claude-proxy` runs as a compose service on the shared `frontend` Docker network
and is reached in-network by Manifest at `http://claude-proxy:8080`. Because it
is only consumed by Manifest on the same compose project, no host port is
published by default. Authentication is via the Claude Code OAuth subscription:
run `./stack login` once to complete the one-time browser flow; credentials
persist in the `claude-proxy-credentials` named volume across restarts and host
reboots (with autostart enabled).

## Quickstart

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

Then:

1. Open <http://localhost:2099> and finish Manifest's `/setup` wizard.
2. In Manifest, add the Anthropic-compatible provider (Settings → Providers →
   Add provider) with Base URL `http://claude-proxy:8080`, API kind `anthropic`,
   API key left blank. See [Configuring Claude Code auth](#configuring-claude-code-auth).
3. Run `./stack login` to authenticate Claude Code OAuth (one-time; opens a
   browser URL; required before first use).
4. Optional: open <http://localhost:2100> for the Homepage landing page.

## Cheap cloud deployment

Run it on a small Ubuntu VPS with Docker Compose, keep app ports closed, and use
Tailscale for access:

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

For fresh VMs, use `cloud-init.yaml` or `bootstrap-vps.sh`; both install Docker,
clone the repo, run `./stack up`, and enable autostart.

Cloud provider notes, Linux Docker firewall details, and reboot-survival behavior
live in [`docs/cloud-deployment.md`](docs/cloud-deployment.md).

`./stack up` will, in order:

1. Initialize the `manifest-local` and `claude-proxy` submodules if needed.
2. Create `.env` from `.env.example` on first run.
3. Auto-generate `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY`.
4. Seed `homepage/.generated/services.yaml` from the template.
5. Bring up Manifest + Postgres + claude-proxy + Homepage via Docker Compose.
6. Print a one-time hint to run `./stack login` to complete Claude OAuth.

`make build` runs only when the CLI version changes or after a code change in
`claude-proxy/`. Build the image locally (no registry pull) before the first
`./stack up` if you are offline:

```bash
cd claude-proxy && make build && cd ..
./stack up
```

Then open:

| URL | Next step |
|---|---|
| <http://localhost:2099> | Finish Manifest's `/setup` wizard to create your admin account |
| <http://localhost:2100> | Homepage landing page for the stack |

Once Manifest is up, run `./stack login` once to complete the Claude OAuth flow
(opens a browser URL; required before first use). Then add the Anthropic-
compatible provider in Manifest (Settings → Providers → Add provider) with:

| Field | Value |
|---|---|
| Base URL | `http://claude-proxy:8080` (in-network; reached by Manifest) |
| API kind | `anthropic` |
| API key | _leave blank_ — subscription mode, no upstream Anthropic key |

`http://claude-proxy:8080` resolves on the `frontend` Docker bridge by service
name; no host port is published, so the URL is not reachable from your browser
or from outside the compose network. Add more providers through the same UI for
any upstream LLM you want Manifest to broker (OpenAI, Ollama, Kimi, etc.) — only
the Claude-shaped provider points at claude-proxy.

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

## Configuring Claude Code auth

The stack no longer runs a host-side reverse proxy. claude-proxy is its own
compose service on the `frontend` Docker network and is reached by Manifest
in-network at `http://claude-proxy:8080`. Configuring it is a one-time OAuth
login:

```bash
./stack login
```

`./stack login` opens an interactive Claude Code OAuth flow inside the
`claude-proxy` container (the browser window is yours; the OAuth tokens are
written to the `claude-proxy-credentials` named volume). Re-run it whenever
the subscription expires or you rotate credentials.

Canonical Claude Code CLI setup, OAuth scopes, and the full API surface live in
[`claude-proxy/README.md`](claude-proxy/README.md). Operator-facing integration
notes (Manifest provider config, in-container verification, log tailing,
troubleshooting, migration notes from the previous host-proxy setup) live in
[`docs/claude-proxy.md`](docs/claude-proxy.md).

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

If `TAILSCALE_HOSTNAME` is also set, the poller adds an **Infrastructure → This
host SSH** tile with `href: ssh://<HOMEPAGE_SSH_USER>@<host>.<tailnet>.ts.net`.
`./stack up` auto-fills missing `TAILSCALE_TS_DOMAIN` and `TAILSCALE_HOSTNAME`
from `tailscale status` when Tailscale is installed and logged in; `./stack
expose` also refreshes both for the current node. `HOMEPAGE_SSH_USER` defaults
to `root`; set `HOMEPAGE_SSH_TILE=0` to suppress the tile.

OAuth client scopes (Tailscale admin → Settings → OAuth clients):

- `devices:core:read` — required, populates the **Tailnet** group.
- `services:read` — optional, populates the **Tailscale Services** group.

Without those vars the poller is skipped and Homepage shows the static template
+ Docker-discovered tiles.

## Publishing via Tailscale (Serve / Funnel)

Once the stack is up on a tailnet-connected host, publish Manifest + Homepage
with one command:

```bash
./stack expose            # interactive
./stack expose --yes      # defaults: Manifest via Funnel, Homepage as a Service
```

Recommended defaults:

- Manifest: public Tailscale Funnel URL.
- Homepage: tailnet-only Tailscale Service URL.

If `./stack expose` reports a tailnet policy error, paste the ACL snippet it
prints into Tailscale admin → Access controls, then rerun the command.

Useful follow-ups:

```bash
tailscale serve status    # see what this host is advertising
./stack unexpose          # remove this node's Serve/Funnel config
```

For policy prerequisites, missing Service recovery, WSL-hosted services, and
SSH/tag tradeoffs, see [`docs/tailscale.md`](docs/tailscale.md).

## Operational docs

- [`docs/cloud-deployment.md`](docs/cloud-deployment.md) — VPS setup, Linux Docker networking, UFW, and autostart.
- [`docs/tailscale.md`](docs/tailscale.md) — Serve/Funnel policy, Service recovery, WSL-hosted services, and SSH/tag tradeoffs.
- [`docs/claude-proxy.md`](docs/claude-proxy.md) — in-stack integration guide, OAuth flow, operator setup.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common failure modes and fixes.

## Commands

| Command | What it does |
|---|---|
| `./stack up` | Start the full stack |
| `./stack down` | Stop everything |
| `./stack restart` | Down + up (recreates compose services) |
| `./stack restart <svc>...` | Recreate specific compose services (re-reads labels + env) |
| `./stack status` | Show container state (`ps` is an alias) |
| `./stack logs` | Tail logs (Manifest, Postgres, claude-proxy, and Homepage) |
| `./stack pull` | Update submodules + Docker images + `make build` for claude-proxy |
| `./stack opencode` | Print an OpenCode config snippet (JSON on stdout) |
| `./stack claude` | Print Claude Code `.claude/*` settings (JSON on stdout) |
| `./stack login` | Run the Claude OAuth login in the claude-proxy container (interactive; one-time per host) |
| `./stack expose` | Configure Tailscale Serve/Funnel + `.env` for this node (interactive) |
| `./stack unexpose` | Remove this node's Tailscale Serve/Funnel (idempotent) |
| `./stack autostart enable` \| `disable` \| `status` | Install/remove a systemd unit so the stack comes back after a host reboot (Linux + systemd) |

On Windows without WSL or Git Bash, use `.\stack.ps1 <command>` instead.

## Environment variables

All configuration lives in a single root `.env`. `./stack up` creates it from
`.env.example` and auto-generates the two required secrets. Routes are no
longer a thing in this stack — claude-proxy is a self-contained OAuth proxy
whose knobs are listed below.

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `2099` | Manifest dashboard port |
| `BETTER_AUTH_URL` | `http://localhost:2099` | Public URL Manifest believes it is at |
| `BETTER_AUTH_SECRET` | _auto_ | Session signing secret (generated if blank) |
| `MANIFEST_ENCRYPTION_KEY` | _auto_ | At-rest encryption for stored provider credentials |
| `PROVIDER_TIMEOUT_MS` | `600000` | Manifest upstream timeout (raised for slow local models) |
| `MANIFEST_IMAGE` | `ghcr.io/josiahsiegel/manifest:latest` | Manifest image used by Compose |
| `CONCURRENCY_MAX` | `50` | Manifest per-user proxy concurrency |
| `MANIFEST_TELEMETRY_DISABLED` | _unset_ | Set `1` to disable anonymous Manifest telemetry |
| `POSTGRES_PASSWORD` | `manifest` | Postgres password; keep in sync with `DATABASE_URL` if both are set |
| `DATABASE_URL` | `postgresql://manifest:manifest@postgres:5432/manifest` | Manifest Postgres connection string |
| `CLAUDE_PROXY_HOST` | `0.0.0.0` | Bind address inside the `claude-proxy` container (must stay all-interfaces so Manifest can reach it on the `frontend` bridge) |
| `CLAUDE_PROXY_PORT` | `8080` | Container-internal listen port (in-network only; no host publish) |
| `CLAUDE_PROXY_LOG_LEVEL` | `INFO` | Standard Python level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `CLAUDE_PROXY_AUTH_TOKEN` | _empty_ | Bearer token every `/v1/messages` caller must present. Empty = trust localhost only (recommended for single-user dev). For LAN/tailnet exposure, set to `openssl rand -hex 32`. |
| `CLAUDE_PROXY_SETTINGS_FILE` | `/etc/claude-proxy/claude-settings.json` | Path to the settings pin file; the image ships a default at this path; mount your own via the `claude-proxy-config` volume to override |
| `CLAUDE_PROXY_WORK_DIR` | `/var/lib/claude-proxy/sessions` | Working directory for session transcripts (persisted via `claude-proxy-data` volume) |
| `CLAUDE_PROXY_NUM_SLOTS` | `1` | Subscription slots; v1 default is 1. Multi-slot is wired but not load-tested. |
| `CLAUDE_PROXY_ALLOWED_CLI_VERSIONS` | `2.1.233` | Comma-separated CLI version allowlist. Matches the `CLAUDE_VERSION` baked into the image; defense-in-depth at runtime. |
| `CLAUDE_PROXY_ENABLE_TOOLS` | `false` | Set `true` to surface `tool_use` blocks to API clients (v1 default is `false` — the CLI runs the tool loop internally) |
| `CLAUDE_PROXY_STRUCTURED_LOGS` | `true` | Emit JSON-structured logs (parsed transparently by `./stack logs`) |
| `CLAUDE_PROXY_CREDENTIALS_PATH_TEMPLATE` | `{home}/.claude/.credentials.json` | Path pattern for the OAuth credentials file; `{home}` and `{slot=N}` template vars are supported |
| `CLAUDE_PROXY_MODELS` | _empty_ | Comma-separated `api_name:cli_short_name` pairs (e.g. `claude-sonnet-4-5:sonnet,claude-opus-4-5:opus`). Drives both `/v1/models` and body model → `claude --model` alias lookup. Empty = built-in 7-model fallback. Override when Anthropic ships new model versions so the upgrade is an env-var change, not a code change. |
| `HOMEPAGE_PORT` | `2100` | Homepage dashboard port |
| `HOMEPAGE_ALLOWED_HOSTS` | `localhost:2100` | CSRF allow-list (add tailnet host here) |
| `HOMEPAGE_PUBLIC_URL` | _unset_ | Public URL Homepage should link to itself with, usually a tailnet URL |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | _unset_ | Optional Google OAuth credentials for Manifest login |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | _unset_ | Optional GitHub OAuth credentials for Manifest login |
| `TAILSCALE_OAUTH_CLIENT_ID` + `TAILSCALE_OAUTH_CLIENT_SECRET` _or_ `TAILSCALE_API_KEY` | _unset_ | Enables tailnet-poller sidecar |
| `TAILSCALE_TS_DOMAIN`, `TAILSCALE_HOSTNAME`, `TAILSCALE_TAILNET`, `TAILSCALE_TAG_FILTER`, `TAILSCALE_POLL_INTERVAL_MS` | _unset_ / `60000` | Tailnet poller tunables |
| `HOMEPAGE_SSH_USER`, `HOMEPAGE_SSH_TILE` | `root`, `1` | Dynamic `ssh://` tile for this host |
| `CLAUDE_CODE_MANIFEST_URL`, `CLAUDE_CODE_MODEL` | _derived_ | Used only by `./stack claude` output |

See `.env.example` for the full annotated list.

## Updating

```bash
./stack pull
./stack restart
```

Pulls the latest commits on each submodule's default branch, pulls the latest
Manifest Docker image, rebuilds the claude-proxy image, and restarts the stack.

Quick claude-proxy-only refresh after a code change or CLI version bump in the
submodule:

```bash
git -C claude-proxy fetch origin
git -C claude-proxy checkout main
git -C claude-proxy pull --ff-only
cd claude-proxy && make build && cd ..
./stack restart claude-proxy
```

`make build` is only required when the CLI version changes or after a code
change in `claude-proxy/`. Pulling the parent alone does not guarantee
`claude-proxy/` is on the latest commit; the parent repo only records a
submodule commit pointer.

## Layout

```text
ai-gateway-dev-stack/
├── manifest-local/             # submodule — Manifest + Postgres compose
├── claude-proxy/               # submodule — Claude Code OAuth subscription proxy
├── homepage/                   # parent-owned — dashboard config + tailnet-poller
│   ├── config/                 # hand-edited yaml (mounted at /app/config)
│   ├── services.template.yaml  # source of truth for static service tiles
│   ├── .generated/             # generated services.yaml (gitignored)
│   └── tailnet-poller/         # optional sidecar (zero-dep Node script)
├── compose.yml                 # parent overrides (wires manifest, homepage, poller)
├── stack                       # bash orchestrator (the one command)
├── stack.ps1                   # PowerShell shim that delegates to bash/WSL
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

- **Docker** (Docker Desktop with WSL integration on Windows is fine) — no host-side Node or Python needed; claude-proxy runs in its own container
- **Bash** (WSL, Git Bash, macOS, or Linux)

## Troubleshooting & FAQ

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for common failure
modes: Manifest startup errors, missing Homepage tiles, tailnet-poller issues,
and data persistence.

Common quick checks:

- **claude-proxy keeps restarting** — run `./stack login` (OAuth may have
  expired or the credentials volume needs to be reissued), or
  `cd claude-proxy && make build` if the image needs rebuilding after a CLI
  version bump.
- **Manifest can't reach `http://claude-proxy:8080`** — confirm both containers
  are on the same compose project (`docker compose ... ps`) and that no
  `proxy.routes.json`-style config remains in your `.env`. The URL resolves by
  service name on the `frontend` Docker bridge; nothing reaches it from the
  host browser.
- **`./stack login` says "stdin is not a TTY"** — run it from a real terminal
  (PowerShell, macOS Terminal, WSL shell, etc.). The OAuth flow needs a TTY
  attached to forward the interactive prompts. Use `./stack login --no-tty`
  to print the manual-instructions variant from CI.
