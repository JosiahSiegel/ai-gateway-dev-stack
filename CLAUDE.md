# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Purpose

This repo is the parent orchestration layer for a local AI gateway stack. It combines two submodules plus parent-owned services:

- `manifest-local/` — Docker Compose deployment for Manifest, the self-hosted AI gateway dashboard plus Postgres.
- `provider-proxy/` — a host-running Node.js reverse proxy that injects headers and patches request bodies before forwarding to upstream LLM providers.
- `homepage/` — parent-owned config + sidecar for the gethomepage.dev dashboard. Not a submodule; the homepage container is pulled from `ghcr.io/gethomepage/homepage:latest`.

The parent repo wires the pieces together; it should avoid modifying submodule internals unless the task is explicitly about that submodule.

Runtime flow:

```text
OpenCode / Claude Code -> Manifest (Docker :2099) -> provider-proxy (host :9997) -> upstream LLMs
                                                                                     ^
                          Homepage (Docker :2100) — landing page for the stack ------+
                          + tailnet-poller (optional sidecar, profile: tailnet)
```

Manifest reaches the host proxy from inside Docker via `host.docker.internal:${PROXY_PORT}`. The proxy intentionally runs on the host and binds `127.0.0.1` only.

## Common Commands

Use the root `stack` script for normal development and operations:

| Task | Bash / WSL / Git Bash | PowerShell |
|---|---|---|
| Start full stack | `./stack up` | `.\stack.ps1 up` |
| Stop full stack | `./stack down` | `.\stack.ps1 down` |
| Restart stack | `./stack restart` | `.\stack.ps1 restart` |
| Restart specific service(s) | `./stack restart <svc>...` | `.\stack.ps1 restart <svc>...` |
| Show container and proxy status | `./stack status` | `.\stack.ps1 status` |
| Tail Manifest, Postgres, and proxy logs | `./stack logs` | `.\stack.ps1 logs` |
| Update submodules and Docker images | `./stack pull` | `.\stack.ps1 pull` |
| Print OpenCode config snippet | `./stack opencode` | `.\stack.ps1 opencode` |
| Print Claude Code settings instructions | `./stack claudcode` | `.\stack.ps1 claudcode` |

There is no build, lint, or test command at the root. This repo is shell/Compose orchestration plus submodules. `provider-proxy` also has no install/build/test step and runs directly with Node.js built-ins.

Useful lower-level commands when debugging Manifest directly:

```bash
docker compose --project-directory . --env-file .env -f manifest-local/docker-compose.yml -f compose.yml ps
docker compose --project-directory . --env-file .env -f manifest-local/docker-compose.yml -f compose.yml logs -f manifest
docker compose --project-directory . --env-file .env -f manifest-local/docker-compose.yml -f compose.yml exec postgres psql -U manifest -d manifest
```

Run the proxy directly only when working inside `provider-proxy/`:

```bash
TARGETS='[{"pathPrefix":"/openai","host":"api.openai.com"}]' PROXY_PORT=9997 node provider-proxy/provider-proxy.js
```

## Configuration Model

Root `.env.example` is the single template for the combined stack. `./stack up` creates `.env` if missing and auto-generates `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY` when blank.

Important root variables:

- `PORT` — Manifest dashboard port, default `2099`.
- `BETTER_AUTH_URL` — URL Manifest uses for generated auth links and callbacks.
- `PROVIDER_TIMEOUT_MS` — Manifest upstream provider timeout; default in this stack is raised for slow local models.
- `PROXY_PORT` — host proxy port, default `9997`.
- `PROXY_TARGETS` — JSON array for path-prefix routing, defaulting to `/kimi` and `/openai` routes.
- `PROXY_TARGET_HOST` / `PROXY_TARGET_PROTOCOL` / `PROXY_TARGET_PORT` — single-target alternative; use instead of `PROXY_TARGETS`.
- `PROXY_USER_AGENT`, `PROXY_EXTRA_HEADERS`, `PROXY_DEBUG`, `PROXY_DEBUG_BODY` — mapped by `stack` to provider-proxy environment variables.
- `CLAUDE_CODE_MANIFEST_URL`, `CLAUDE_CODE_MODEL` — used only by `./stack claudcode` to print Claude Code settings.
- `HOMEPAGE_PORT`, `HOMEPAGE_ALLOWED_HOSTS` — homepage dashboard binding and CSRF allow-list.
- `TAILSCALE_API_KEY`, `TAILSCALE_TAILNET`, `TAILSCALE_TS_DOMAIN`, `TAILSCALE_TAG_FILTER`, `TAILSCALE_POLL_INTERVAL_MS` — when `TAILSCALE_API_KEY` is set, `./stack` adds `--profile tailnet` and the tailnet-poller container rewrites `homepage/config/services.yaml` on a timer.

Local-only files/directories are ignored: `.env`, `.env.local`, `.stack/`, logs, and `.claude/`.

## Architecture Notes

### Root orchestration

`stack` is the primary control plane. It:

1. Initializes `manifest-local` and `provider-proxy` submodules if needed.
2. Ensures `.env` exists and contains generated secrets.
3. Runs Docker Compose with both `manifest-local/docker-compose.yml` and the root `compose.yml` overlay.
4. Starts/stops `provider-proxy/provider-proxy.js` as a host process and records PID/logs under `.stack/`.

`stack.ps1` is a Windows shim. It prefers WSL, converts the repo path to `/mnt/<drive>/...`, and delegates to `./stack`; otherwise it uses Git Bash if available.

### Compose layering

The effective Compose command is:

```bash
docker compose --project-directory . --env-file .env -f manifest-local/docker-compose.yml -f compose.yml <command>
```

`manifest-local/docker-compose.yml` owns the real services, networks, and volume. Root `compose.yml` is intentionally minimal and should be used for parent-level overrides without touching the submodule. Do not override Compose `name:` at the root; `manifest-local` pins it to `mnfst` so existing standalone installs keep the same containers and `manifest_pgdata` volume.

### Manifest submodule

`manifest-local/` is infrastructure-only for the prebuilt `manifestdotbuild/manifest:latest` image. It defines:

- `manifest` app container on `${PORT:-2099}`.
- `postgres` on Postgres 16 Alpine.
- `internal` and `frontend` Docker networks.
- `manifest_pgdata` pinned volume.

Refer to `manifest-local/CLAUDE.md` before making changes inside that submodule.

### Homepage dashboard

`homepage/` is parent-owned (no submodule). Layout:

- `homepage/config/` — mounted into the container at `/app/config`. Contains `settings.yaml`, `widgets.yaml`, `bookmarks.yaml`, `docker.yaml`, and the generated `services.yaml` (gitignored).
- `homepage/services.template.yaml` — user-editable source of truth. Seeded into `homepage/config/services.yaml` on first `./stack up`. When the tailnet-poller is running, it reads the template, appends a managed `- Tailnet:` group, and rewrites `services.yaml` atomically every tick.
- `homepage/tailnet-poller/poll.js` — single-file zero-dep Node script that calls the Tailscale `/api/v2/tailnet/{tailnet}/devices` endpoint and renders the managed group.

Stack-internal services (Manifest, homepage itself) appear via Docker label auto-discovery — labels live in `compose.yml` so we don't touch the `manifest-local` submodule. Anything else (host processes like the provider-proxy, or arbitrary external URLs) goes in `services.template.yaml`. Don't add a `- Tailnet:` group to the template by hand — anything after the `# --- managed: tailnet (do not edit below) ---` marker is overwritten by the poller.

The poller runs under Compose profile `tailnet`. `./stack` adds `--profile tailnet` automatically when `TAILSCALE_API_KEY` is set in `.env`.

### provider-proxy submodule

`provider-proxy/provider-proxy.js` is a single-file Node.js reverse proxy with no dependencies. It supports:

- single-target forwarding via `TARGET_HOST`;
- multi-target routing via `TARGETS` path prefixes;
- injected global and per-route headers;
- JSON body patches for known provider compatibility issues;
- stream-through forwarding for non-JSON or non-mutating requests.

Refer to `provider-proxy/CLAUDE.md` before making changes inside that submodule.

## Operational Details

- First-run dashboard setup is at `http://localhost:2099/setup` after `./stack up`.
- Manifest provider Base URLs should point at Docker's host gateway, e.g. `http://host.docker.internal:9997/openai/v1` or `http://host.docker.internal:9997/kimi/v1`.
- `./stack down` stops the host proxy first, then runs Compose down. It does not remove the pinned Postgres volume.
- `./stack pull` updates submodules with `git submodule update --remote --merge` and pulls Compose images.
- For direct submodule work, `cd` into the submodule and use its own README/CLAUDE.md; remember submodule commits are tracked separately from the parent repo.
