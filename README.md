# ai-gateway-dev-stack

One-command local AI gateway for **OpenCode**, **Claude Code**, and any other
OpenAI-compatible client. Bundles [Manifest](https://manifest.build) (the
self-hosted gateway dashboard), [provider-proxy](https://github.com/JosiahSiegel/provider-proxy)
(a tiny header/body patcher in front of upstream providers), and a
[gethomepage.dev](https://gethomepage.dev) landing page for the stack into a
single clone-and-go dev environment.

```
OpenCode / Claude Code  ->  Manifest (Docker :2099)  ->  provider-proxy (host :9997)  ->  upstream LLMs
                                                                                          ^
                            Homepage (Docker :2100) — landing page for the stack ---------+
                            + tailnet-poller (optional sidecar)
```

## Quickstart

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

That's it. `./stack up` will:

1. Initialize the `manifest-local` and `provider-proxy` submodules if needed.
2. Create `.env` from `.env.example` on first run.
3. Auto-generate `BETTER_AUTH_SECRET` and `MANIFEST_ENCRYPTION_KEY`.
4. Bring up the Manifest + Postgres + Homepage containers via Docker Compose.
5. Start `provider-proxy` on the host (`127.0.0.1:9997`) with sensible
   defaults already wired (`/openai` and `/kimi` routes).

Two URLs to know:

- <http://localhost:2099> — Manifest dashboard. Finish the `/setup` wizard to
  create your admin account.
- <http://localhost:2100> — Homepage landing page for the stack.

## Wire up the proxy

The default `.env.example` already wires the proxy with `/openai` and
`/kimi` routes, so `./stack up` brings it up immediately. To add routes,
edit `PROXY_TARGETS` in `.env` and run `./stack restart`.

In the Manifest dashboard, add a provider whose **Base URL** points at the
proxy from inside Docker:

```
http://host.docker.internal:9997/openai/v1
http://host.docker.internal:9997/kimi/v1
```

To switch to a single-target setup instead, comment out `PROXY_TARGETS`
and set `PROXY_TARGET_HOST=<upstream>`.

## Hook up OpenCode (WSL or anywhere)

```bash
./stack opencode
```

Pipes a ready-to-use `opencode.json` snippet to stdout. Drop it into
`~/.config/opencode/opencode.json` (or this project's `opencode.json`),
restart OpenCode, and you're talking to Manifest through this stack.

## Hook up Claude Code

```bash
./stack claudcode
```

Prints the project `.claude/settings.json` and `.claude/settings.local.json`
pattern for routing Claude Code through Manifest. The token stays local and
should never be committed.

## Homepage dashboard

Homepage is a [gethomepage.dev](https://gethomepage.dev) container at
<http://localhost:2100> that lists everything in the stack. Stack-internal
services (Manifest, Homepage itself) appear automatically via Docker label
discovery — no config needed. Anything else (host processes, external URLs)
goes in `homepage/services.template.yaml`.

Customize via the YAML files in `homepage/config/`:

- `settings.yaml` — title, theme, quicklaunch (press `/` to filter tiles)
- `widgets.yaml` — info widgets (resources, datetime, …)
- `bookmarks.yaml` — bookmark groups
- `services.template.yaml` — static service tiles (the source of truth;
  `services.yaml` is generated from it)

After editing, run `./stack restart homepage` to pick up the changes.

### Optional: tailnet integration

If you set `TAILSCALE_OAUTH_CLIENT_ID` and `TAILSCALE_OAUTH_CLIENT_SECRET`
(or `TAILSCALE_API_KEY`) plus `TAILSCALE_TS_DOMAIN` in `.env`, `./stack up`
adds a `tailnet-poller` sidecar that rewrites `homepage/config/services.yaml`
every minute with live tiles for your tailnet devices and any Tailscale VIP
services. Without those vars, the poller is skipped and Homepage just shows
the static template + Docker-discovered tiles.

OAuth client scopes (create on the Tailscale admin → Settings → OAuth clients):

- `devices:core:read` — required, populates the **Tailnet** group
- `services:read` — optional, populates the **Tailscale Services** group

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

On Windows without WSL or Git Bash, use `.\stack.ps1 <command>` instead —
it forwards into WSL if available.

## Updating

```bash
./stack pull
./stack restart
```

This pulls the latest commits on each submodule's default branch, pulls the
latest Manifest Docker image, and restarts the stack.

## Layout

```
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

Both submodules are independent repos — you can `cd` into either one and
work on it directly. The parent repo only adds orchestration; it never
modifies the children.

### Compatibility with a previous standalone `manifest-local` install

If you'd already been running `manifest-local` on its own, the parent stack
reuses the same Docker Compose project name (`mnfst`) and the same Postgres
volume name (`manifest_pgdata`). Switching to `./stack up` adopts the
existing containers and database without migration.

## Requirements

- Docker (Docker Desktop with WSL integration on Windows is fine)
- Node.js 18+ on the host that will run `./stack` (provider-proxy uses only
  built-in modules — no `npm install`)
- Bash (WSL, Git Bash, macOS, or Linux)

## Why provider-proxy runs on the host (not in Docker)

`provider-proxy` intentionally binds to `127.0.0.1` only as a defense-in-depth
measure (see its README). Containerizing it would either expose it on a
Docker network the proxy was never designed to be reachable on, or require
patching its bind address. Running it as a host process matches its
documented usage and keeps the surface area minimal — Manifest reaches it
via `host.docker.internal` from inside its container.
