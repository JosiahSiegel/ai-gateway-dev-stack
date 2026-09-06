<div align="center">

# ai-gateway-dev-stack

**One-command local AI gateway for OpenCode, Claude Code, and any OpenAI-compatible client.**

[![CI](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/ci.yml)
[![E2E](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml/badge.svg)](https://github.com/JosiahSiegel/ai-gateway-dev-stack/actions/workflows/e2e.yml)
[![Docker Compose](https://img.shields.io/badge/docker--compose-ready-2496ED?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Platforms](https://img.shields.io/badge/platforms-linux%20%7C%20macOS%20%7C%20WSL-blue)](#requirements)

Bundles [Manifest](https://manifest.build) (self-hosted gateway dashboard +
Postgres, from the `manifest-local` submodule) and a
[gethomepage.dev](https://gethomepage.dev) landing page, with an optional
tailnet-poller, into a single clone-and-go dev environment.

</div>

---

## Contents

- [Why](#why)
- [Architecture](#architecture)
- [Quickstart](#quickstart)
- [Cheap cloud deployment](#cheap-cloud-deployment)
- [Hook up clients](#hook-up-clients)
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
credentials. This stack pre-wires the dashboard and gateway so the only thing
you do is `./stack up`.

- **Minimal host install** — only Docker and Bash.
- **One `.env`** for the whole stack, with auto-generated secrets on first run.
- **Stack-internal services auto-appear** on the Homepage via Docker labels.
- **Compatible with existing `manifest-local` installs** — same Compose project name and Postgres volume.

## Architecture

```text
   request pipe ───────────────────────────────────────────────────────────►
┌─────────────────────┐   ┌────────────────────┐   ┌──────────────────────────┐
│ OpenCode /          │──►│ Manifest           │──►│ Upstream LLM providers   │
│ Claude Code         │   │ (Docker :2099)     │   │ configured in Manifest   │
│ (host CLI)          │   │                    │   │ (OpenAI / Anthropic APIs) │
└─────────────────────┘   └────────────────────┘   └──────────────────────────┘

  side-car (not on the request pipe):
    Homepage (Docker :2100)  — landing page tiles for the stack
    tailnet-poller           — optional, profile: tailnet
```

Manifest brokers any OpenAI-compatible or Anthropic-compatible upstream you
configure through its dashboard. Client tools connect to Manifest rather than
to each provider directly.

## Quickstart

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

Then:

1. Open <http://localhost:2099> and finish Manifest's `/setup` wizard.
2. In Manifest, add a provider (Settings → Providers → Add provider) using the
   Base URL, API kind, and credentials for your OpenAI-compatible or
   Anthropic-compatible upstream.
3. Optional: open <http://localhost:2100> for the Homepage landing page.

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

1. Initialize the `manifest-local` submodule if needed.
2. Create `.env` from `.env.example` on first run.
3. Auto-generate `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY`.
4. Seed `homepage/.generated/services.yaml` from the template.
5. Bring up Manifest + Postgres + Homepage via Docker Compose.

Then open:

| URL | Next step |
|---|---|
| <http://localhost:2099> | Finish Manifest's `/setup` wizard to create your admin account |
| <http://localhost:2100> | Homepage landing page for the stack |

Once Manifest is up, add a provider through Settings → Providers → Add
provider. Enter the upstream's Base URL and credentials, then select the
matching OpenAI-compatible or Anthropic-compatible API kind. Add as many
providers as you want Manifest to broker (OpenAI, Anthropic, Ollama, Kimi,
etc.).

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
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common failure modes and fixes.

## Commands

| Command | What it does |
|---|---|
| `./stack up` | Start the full stack |
| `./stack down` | Stop everything |
| `./stack restart` | Down + up (recreates compose services) |
| `./stack restart <svc>...` | Recreate specific compose services (re-reads labels + env) |
| `./stack status` | Show container state (`ps` is an alias) |
| `./stack logs` | Tail logs (Manifest, Postgres, Homepage, and optional tailnet-poller) |
| `./stack pull` | Update submodules + Docker images |
| `./stack opencode` | Print an OpenCode config snippet (JSON on stdout) |
| `./stack claude` | Print Claude Code `.claude/*` settings (JSON on stdout) |
| `./stack expose` | Configure Tailscale Serve/Funnel + `.env` for this node (interactive) |
| `./stack unexpose` | Remove this node's Tailscale Serve/Funnel (idempotent) |
| `./stack autostart enable` \| `disable` \| `status` | Install/remove a systemd unit so the stack comes back after a host reboot (Linux + systemd) |

On Windows without WSL or Git Bash, use `.\stack.ps1 <command>` instead.

## Environment variables

All configuration lives in a single root `.env`. `./stack up` creates it from
`.env.example` and auto-generates the two required secrets.

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

Pulls the latest commit on the `manifest-local` submodule's default branch,
pulls the latest Docker images, and restarts the stack.

## Layout

```text
ai-gateway-dev-stack/
├── manifest-local/             # submodule — Manifest + Postgres compose
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

The `manifest-local` submodule is an independent repo — you can `cd` into it
and work on it directly. The parent repo only adds orchestration; it never
modifies the child.

### Compatibility with a previous standalone `manifest-local` install

If you'd already been running `manifest-local` on its own, this parent stack
reuses the same Docker Compose project name (`mnfst`) and Postgres volume name
(`manifest_pgdata`). Switching to `./stack up` adopts the existing containers
and database without migration.

## Requirements

- **Docker** (Docker Desktop with WSL integration on Windows is fine)
- **Bash** (WSL, Git Bash, macOS, or Linux)

## Troubleshooting & FAQ

See [`docs/troubleshooting.md`](docs/troubleshooting.md) for common failure
modes: Manifest startup errors, missing Homepage tiles, tailnet-poller issues,
and data persistence.
