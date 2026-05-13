# ai-gateway-dev-stack

One-command local AI gateway for **OpenCode**, **Claude Code**, and any other
OpenAI-compatible client. Bundles [Manifest](https://manifest.build) (the
self-hosted gateway dashboard) and [provider-proxy](https://github.com/JosiahSiegel/provider-proxy)
(a tiny header/body patcher in front of upstream providers) into a single
clone-and-go dev stack.

```
OpenCode / Claude Code  ->  Manifest (Docker :2099)  ->  provider-proxy (host :9999)  ->  upstream LLMs
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
4. Bring up the Manifest + Postgres containers via Docker Compose.
5. Start `provider-proxy` on the host (`127.0.0.1:9999`) if you've configured
   a target in `.env`. If no target is configured yet, it skips the proxy and
   tells you so.

Open the dashboard at <http://localhost:2099>, finish the `/setup` wizard to
create your admin account, and you're live.

## Wire up the proxy

Pick **one** of these in `.env`:

**Single target** (everything goes to one upstream):

```env
PROXY_TARGET_HOST=app.manifest.build
```

**Multi-target** (recommended — route by path prefix):

```env
PROXY_TARGETS=[{"pathPrefix":"/openai","host":"api.openai.com"},{"pathPrefix":"/anthropic","host":"api.anthropic.com"}]
```

Then `./stack restart`.

In the Manifest dashboard, add a provider whose **Base URL** points at the
proxy from inside Docker:

```
http://host.docker.internal:9999/openai/v1
```

## Hook up OpenCode (WSL or anywhere)

```bash
./stack opencode
```

Pipes a ready-to-use `opencode.json` snippet to stdout. Drop it into
`~/.config/opencode/opencode.json` (or this project's `opencode.json`),
restart OpenCode, and you're talking to Manifest through this stack.

## Hook up Claude Code

Point Claude Code at Manifest the same way you'd point it at any
OpenAI-compatible gateway — typically via `ANTHROPIC_BASE_URL` or your
Claude Code provider config — using:

- `http://localhost:2099/v1` — go through Manifest (recommended; gives you
  rate limits, logging, and usage tracking).
- `http://127.0.0.1:9999/<route>/v1` — go straight through the proxy (skips
  Manifest; useful for debugging upstream-specific issues).

## Commands

| Command | What it does |
|---|---|
| `./stack up` | Start the full stack |
| `./stack down` | Stop everything |
| `./stack restart` | Down + up |
| `./stack status` | Show container + proxy state |
| `./stack logs` | Tail Manifest, Postgres, and proxy logs |
| `./stack pull` | Update submodules + Docker images |
| `./stack opencode` | Print an OpenCode config snippet |

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
├── compose.yml          # parent overrides (wires manifest -> proxy)
├── stack                # bash orchestrator (the one command)
├── stack.ps1            # PowerShell shim that delegates to bash/WSL
├── .env.example         # single source of truth for all config
└── .env                 # local config (gitignored)
```

Both submodules are independent repos — you can `cd` into either one and
work on it directly. The parent repo only adds orchestration; it never
modifies the children.

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
