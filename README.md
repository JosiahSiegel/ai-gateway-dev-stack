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
- [Wire up the proxy](#wire-up-the-proxy)
- [Hook up clients](#hook-up-clients)
- [Homepage dashboard](#homepage-dashboard)
- [Commands](#commands)
- [Configuration](#configuration)
- [Updating](#updating)
- [Layout](#layout)
- [Requirements](#requirements)
- [Troubleshooting](#troubleshooting)
- [FAQ](#faq)

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
OpenCode / Claude Code  ──►  Manifest (Docker :2099)  ──►  provider-proxy (host :9997)  ──►  upstream LLMs
                                                                                              ▲
                             Homepage (Docker :2100) ── landing page for the stack ──────────-┘
                             + tailnet-poller (optional sidecar, profile: tailnet)
```

Manifest reaches the host proxy via `host.docker.internal:${PROXY_PORT}`. The
proxy intentionally binds `127.0.0.1` only — it is not exposed to Docker
networks or the LAN.

## Quickstart

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

`./stack up` will:

1. Initialize the `manifest-local` and `provider-proxy` submodules if needed.
2. Create `.env` from `.env.example` on first run.
3. Auto-generate `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY`.
4. Bring up Manifest + Postgres + Homepage via Docker Compose.
5. Start `provider-proxy` on the host (`127.0.0.1:9997`) with `/openai` and `/kimi` routes pre-wired.

Then open:

| URL | What |
|---|---|
| <http://localhost:2099> | Manifest dashboard — finish `/setup` to create your admin account |
| <http://localhost:2100> | Homepage landing page for the stack |

> **Windows users**: use `.\stack.ps1 <command>`. It forwards into WSL or Git Bash automatically.

## Wire up the proxy

The default `.env.example` already wires the proxy with `/openai` and `/kimi`
routes. To add routes, edit `PROXY_TARGETS` in `.env` and run `./stack restart`.

In the Manifest dashboard, add a provider whose **Base URL** points at the
proxy from inside Docker:

```
http://host.docker.internal:9997/openai/v1
http://host.docker.internal:9997/kimi/v1
```

To switch to a single-target setup instead, comment out `PROXY_TARGETS` and
set `PROXY_TARGET_HOST=<upstream>`.

## Hook up clients

### OpenCode

```bash
./stack opencode
```

Pipes a ready-to-use `opencode.json` snippet to stdout. Drop it into
`~/.config/opencode/opencode.json` (or this project's `opencode.json`),
restart OpenCode, and you're talking to Manifest through this stack.

### Claude Code

```bash
./stack claudcode
```

Prints the project `.claude/settings.json` and `.claude/settings.local.json`
pattern for routing Claude Code through Manifest. The token stays local and
should never be committed.

## Homepage dashboard

A [gethomepage.dev](https://gethomepage.dev) container at <http://localhost:2100>
that lists everything in the stack. Stack-internal services (Manifest,
Homepage itself) appear automatically via Docker label discovery — no config
needed. Anything else (host processes, external URLs) goes in
`homepage/services.template.yaml`.

Customize via the YAML files in `homepage/config/`:

| File | Purpose |
|---|---|
| `settings.yaml` | Title, theme, quicklaunch (press `/` to filter tiles) |
| `widgets.yaml` | Info widgets (resources, datetime, …) |
| `bookmarks.yaml` | Bookmark groups |
| `services.template.yaml` | Static service tiles — source of truth; `services.yaml` is generated from it |

After editing, run `./stack restart homepage` to pick up the changes.

<details>
<summary><strong>Optional: Tailnet integration</strong></summary>

If you set `TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET` (or
`TAILSCALE_API_KEY`) plus `TAILSCALE_TS_DOMAIN` in `.env`, `./stack up` adds a
`tailnet-poller` sidecar that rewrites `homepage/config/services.yaml` every
minute with live tiles for your tailnet devices and any Tailscale VIP
services. Without those vars, the poller is skipped and Homepage just shows
the static template + Docker-discovered tiles.

OAuth client scopes (create on the Tailscale admin → Settings → OAuth clients):

- `devices:core:read` — required, populates the **Tailnet** group
- `services:read` — optional, populates the **Tailscale Services** group

</details>

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
| `./stack opencode` | Print an OpenCode config snippet |
| `./stack claudcode` | Print Claude Code settings instructions |

On Windows without WSL or Git Bash, use `.\stack.ps1 <command>` instead — it forwards into WSL if available.

## Configuration

All configuration lives in a single root `.env`. The `./stack up` command will
create it from `.env.example` and auto-generate the two required secrets.

<details>
<summary><strong>Key environment variables</strong></summary>

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `2099` | Manifest dashboard port |
| `BETTER_AUTH_URL` | `http://localhost:2099` | Public URL Manifest believes it is at |
| `BETTER_AUTH_SECRET` | _auto_ | Session signing secret (generated if blank) |
| `MANIFEST_ENCRYPTION_KEY` | _auto_ | At-rest encryption for stored provider credentials |
| `PROVIDER_TIMEOUT_MS` | `600000` | Manifest upstream timeout (raised for slow local models) |
| `PROXY_PORT` | `9997` | Host proxy port (binds `127.0.0.1` only) |
| `PROXY_TARGETS` | _see `.env.example`_ | JSON array of `{pathPrefix, host}` routes |
| `PROXY_TARGET_HOST` | _unset_ | Single-target alternative to `PROXY_TARGETS` |
| `PROXY_USER_AGENT`, `PROXY_EXTRA_HEADERS` | _unset_ | Header injection |
| `PROXY_DEBUG`, `PROXY_DEBUG_BODY` | _unset_ | Verbose logging |
| `HOMEPAGE_PORT` | `2100` | Homepage dashboard port |
| `HOMEPAGE_ALLOWED_HOSTS` | `localhost:2100` | CSRF allow-list |
| `TAILSCALE_API_KEY` _or_ `TAILSCALE_OAUTH_CLIENT_ID` + `TAILSCALE_OAUTH_CLIENT_SECRET` | _unset_ | Enables tailnet-poller sidecar |
| `CLAUDE_CODE_MANIFEST_URL`, `CLAUDE_CODE_MODEL` | _derived_ | Used only by `./stack claudcode` output |

</details>

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
├── manifest-local/      # submodule — Manifest + Postgres compose
├── provider-proxy/      # submodule — header/body patching proxy
├── homepage/            # parent-owned — dashboard config + tailnet-poller
│   ├── config/          # mounted into the homepage container at /app/config
│   ├── services.template.yaml  # static services (seeds services.yaml)
│   └── tailnet-poller/  # optional sidecar (zero-dep Node script)
├── compose.yml          # parent overrides (wires manifest, homepage, poller)
├── stack                # bash orchestrator (the one command)
├── stack.ps1            # PowerShell shim that delegates to bash/WSL
├── .env.example         # single source of truth for all config
└── .env                 # local config (gitignored)
```

Both submodules are independent repos — you can `cd` into either one and work
on it directly. The parent repo only adds orchestration; it never modifies the
children.

### Compatibility with a previous standalone `manifest-local` install

If you'd already been running `manifest-local` on its own, the parent stack
reuses the same Docker Compose project name (`mnfst`) and Postgres volume name
(`manifest_pgdata`). Switching to `./stack up` adopts the existing containers
and database without migration.

## Requirements

- **Docker** (Docker Desktop with WSL integration on Windows is fine)
- **Node.js 18+** on the host that will run `./stack` (provider-proxy uses only built-in modules — no `npm install`)
- **Bash** (WSL, Git Bash, macOS, or Linux)

## Troubleshooting

<details>
<summary><strong>Manifest can't reach the proxy</strong></summary>

From inside the Manifest container, the proxy is at `host.docker.internal:${PROXY_PORT}`, **not** `localhost`. Make sure your provider Base URL uses `host.docker.internal`, and that `./stack status` reports `provider-proxy: running`.
</details>

<details>
<summary><strong>provider-proxy failed to start</strong></summary>

Check `.stack/proxy.log` for the actual error. Common causes: port `9997` already taken, or `PROXY_TARGETS` JSON is malformed. After fixing, run `./stack restart`.
</details>

<details>
<summary><strong>Homepage shows no tiles</strong></summary>

Stack-internal tiles come from Docker labels in `compose.yml` and require the Docker socket mount. If you've sandboxed Docker, the homepage container won't see other containers. Static tiles go in `homepage/services.template.yaml`; run `./stack restart homepage` after edits.
</details>

<details>
<summary><strong>Tailnet group never appears</strong></summary>

Confirm `TAILSCALE_API_KEY` (or both OAuth vars) and `TAILSCALE_TS_DOMAIN` are set in `.env`. `./stack status` should show a `tailnet-poller` container. `docker logs tailnet-poller` shows API-call results.
</details>

## FAQ

**Why does `provider-proxy` run on the host instead of in Docker?**
It binds `127.0.0.1` only as a defense-in-depth measure. Containerizing it
would either expose it on a Docker network the proxy was never designed to be
reachable on, or require patching its bind address. Running it as a host
process matches its documented usage and keeps the surface area minimal —
Manifest reaches it via `host.docker.internal` from inside its container.

**Can I run only Manifest, without the proxy?**
Yes. Leave `PROXY_TARGET_HOST` and `PROXY_TARGETS` blank in `.env` and the
proxy is skipped. Configure Manifest providers directly against upstream URLs.

**Where is data persisted?**
Postgres data lives in the pinned `manifest_pgdata` Docker volume. `./stack
down` stops containers but never removes that volume.
