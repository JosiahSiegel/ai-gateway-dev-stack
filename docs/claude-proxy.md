# claude-proxy — Stack Integration Guide

`claude-proxy` is the in-stack Anthropic-compatible proxy that this stack uses
to talk to Claude Code under a real Anthropic OAuth subscription. It runs as a
Docker compose service on the shared `frontend` network and is reached
in-network by Manifest at `http://claude-proxy:8080`. Because Manifest is the
only consumer, no host port is published by default.

For the canonical Claude Code CLI setup, OAuth flow, and full API surface, see
[`claude-proxy/README.md`](../claude-proxy/README.md). This guide is operator-
facing and focused on the in-stack integration points.

## What this replaces

This stack used to bundle a separate Node.js host process called
`provider-proxy` that:

- bound `127.0.0.1:9997` by default on the host (with `PROXY_BIND=0.0.0.0` as
  a Linux-Docker workaround);
- read upstream routes from `proxy.routes.json` at the repo root;
- hosted the built-in `/agy/v1` Antigravity route;
- required a host-side Node.js install plus a PTY-backed `agy` binary.

`claude-proxy` replaces all of that with a single Docker compose service. The
header/body patching responsibilities drop (the Anthropic-specific OAuth
provider doesn't need them), the host-side Node install goes away (image is
self-contained Python + FastAPI), and the `/agy` route goes away with
`provider-proxy`. If you're upgrading an existing install, see
[Migration notes from provider-proxy](#migration-notes-from-provider-proxy).

## Prerequisites

- Docker (Docker Desktop with WSL integration on Windows is fine).
- A Claude Code OAuth subscription — `claude-proxy` only supports subscription
  auth, not Anthropic API-key auth. Run `./stack login` once to authenticate.
- A terminal capable of running an interactive OAuth flow. `./stack login`
  refuses to proceed if stdin is not a TTY. Use `./stack login --no-tty` from
  CI to print instructions instead.
- Nothing else. The image is self-contained — no host-side Node or Python.

## How it integrates with the stack

```text
   request pipe ────────────────────────────────────────────────────────────
                                                                            
┌───────────────┐   ┌────────────────────┐   ┌──────────────────────┐        
│ OpenCode /    │──►│ manifest           │──►│ claude-proxy         │        
│ Claude Code   │   │ (Docker :2099)     │   │ (Docker :8080)       │        
│ (host CLI)    │   │ http://claude-proxy:8080   │ in-network only    │        
└───────────────┘   └────────────────────┘   └──────────────────────┘        
       │                                              │                       
       │ Manifest provider entry:                     │ OAuth                  ─► Anthropic
       │   Base URL: http://claude-proxy:8080         │ subscription tokens   
       │   API kind: anthropic                                       (Anthropic-hosted
       │   API key: (blank)                                          Claude Code CLI)
       │                                                                   
       └───── ./stack claude emits ANTHROPIC_BASE_URL=manifest:2099 ─────┘   
                          (CLI talks to Manifest, not directly to claude-proxy)
```

Key wiring facts:

- `claude-proxy` is declared as a parent-owned service in `compose.yml`. It
  joins only the `frontend` Docker network (declared by `manifest-local`); it
  does **not** need Postgres.
- Three named Docker volumes persist state across `./stack restart` and host
  reboots (when autostart is enabled):
  - `claude-proxy-credentials` — OAuth tokens (mount: `/home/claude-proxy/.claude`)
  - `claude-proxy-data`        — session transcripts (mount: `CLAUDE_PROXY_WORK_DIR`)
  - `claude-proxy-config`      — settings pin file (mount: `/etc/claude-proxy`)
- No host port is published. There is **no** `host.docker.internal:${PROXY_PORT}`
  URL anywhere — the previous host-proxy pattern is gone.
- Manifest does not ship a built-in way to seed a default Anthropic provider
  (verified by reading `manifest-local/docker-compose.yml` — no
  `MANIFEST_DEFAULT_ANTHROPIC_*` env var exists). The operator MUST add the
  provider entry through the dashboard. See [Add the Anthropic-compatible
  provider in Manifest](#add-the-anthropic-compatible-provider-in-manifest).

## Configuration reference

All knobs live in `.env` under the `CLAUDE_PROXY_*` prefix. `./stack up`
interpolates them into the compose overlay at bring-up. The full canonical
surface (matching the upstream `claude-proxy/docker-compose.yml` defaults):

| Variable | Default | Purpose |
|---|---|---|
| `CLAUDE_PROXY_HOST` | `0.0.0.0` | Bind address inside the container (must stay all-interfaces so Manifest on the `frontend` bridge can reach it by service name) |
| `CLAUDE_PROXY_PORT` | `8080` | Container-internal listen port. **No host publish** — Manifest reaches it at `http://claude-proxy:${CLAUDE_PROXY_PORT}` |
| `CLAUDE_PROXY_LOG_LEVEL` | `INFO` | Standard Python level: `DEBUG`, `INFO`, `WARNING`, `ERROR` |
| `CLAUDE_PROXY_AUTH_TOKEN` | _empty_ | Bearer token every `/v1/messages` caller must present. Empty = trust localhost only (recommended single-user dev). For LAN/tailnet exposure, set to `openssl rand -hex 32` |
| `CLAUDE_PROXY_SETTINGS_FILE` | `/etc/claude-proxy/claude-settings.json` | Path to the settings pin file. The image ships a default at this path; mount your own via the `claude-proxy-config` volume to override |
| `CLAUDE_PROXY_WORK_DIR` | `/var/lib/claude-proxy/sessions` | Working directory for session transcripts (persisted via the `claude-proxy-data` volume) |
| `CLAUDE_PROXY_ALLOWED_WORKSPACE_ROOTS` | `/workspaces` | Default-allowlist for X-Workspace-Path. |
| `CLAUDE_PROXY_NUM_SLOTS` | `1` | Subscription slots. v1 default is 1 (single Pro/Max account). Multi-slot is wired but not load-tested. |
| `CLAUDE_PROXY_ALLOWED_CLI_VERSIONS` | `2.1.233` | Comma-separated CLI version allowlist. Matches the `CLAUDE_VERSION` baked into the Dockerfile; defense-in-depth at runtime so a stale build cannot run a newer/older CLI silently |
| `CLAUDE_PROXY_USER_RATE_LIMIT_CAPACITY` | `60` | Per-user token-bucket burst size |
| `CLAUDE_PROXY_USER_RATE_LIMIT_REFILL_PER_SECOND` | `1.0` | Per-user token-bucket steady-state drain rate |
| `CLAUDE_PROXY_ENABLE_TOOLS` | `false` | Surface `tool_use` blocks to API clients. v1 default is `false` — the CLI runs the tool loop internally |
| `CLAUDE_PROXY_STRUCTURED_LOGS` | `true` | Emit JSON-structured logs (parsed transparently by `./stack logs`) |
| `CLAUDE_PROXY_CREDENTIALS_PATH_TEMPLATE` | `{home}/.claude/.credentials.json` | Path pattern for the OAuth credentials file. Supports `{home}` and `{slot=N}` template variables for multi-slot deployments |
| `CLAUDE_PROXY_MODELS` | _empty_ | Comma-separated `api_name:cli_short_name` pairs (e.g. `claude-sonnet-5:sonnet,claude-opus-5:opus`). Drives both `/v1/models` and `body.model` → `claude --model` alias lookup. Empty = built-in 7-model hardcoded fallback. **Override with only the model short aliases the SHIPPED Claude Code CLI version + your OAuth subscription tier actually allow** — see the troubleshooting note below |

See `.env.example` for the annotated source of truth.

## Operational runbook

### Healthcheck

The container's Docker healthcheck pings `curl -fsS http://127.0.0.1:8080/healthz`
periodically. To verify from the host (assuming shell access to the container):

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec claude-proxy curl -fsS http://127.0.0.1:8080/healthz
```

To verify in-network reachability (from inside Manifest's container):

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec manifest wget -qO- http://claude-proxy:8080/healthz
```

If the second command returns the same JSON payload as the first, Manifest can
reach `claude-proxy` and the dashboard's "Test connection" button will succeed.

### One-time login

```bash
./stack login
```

This `docker compose exec -it claude-proxy claude-proxy login`'s the
container, opens the Anthropic OAuth URL in your local browser, and persists
the credentials to `/home/claude-proxy/.claude/.credentials.json` inside the
`claude-proxy-credentials` named volume.

The flow is interactive; it requires a TTY (refuses to run otherwise). To
print instructions without starting an interactive flow (CI, scripted):

```bash
./stack login --no-tty
```

### OAuth expiry / re-auth

Since submodule commit `91f5b3f` (PR #1, "always-auth"), the proxy
auto-refreshes the OAuth access token in a daemon thread when within
`CLAUDE_PROXY_REFRESH_LEAD_SECONDS` (default 300s) of expiry. The default
OAuth client is Anthropic's public one (`9d1c250a-...`); override
`CLAUDE_PROXY_OAUTH_CLIENT_ID` in `.env` only if you maintain a fork of the
CLI with your own OAuth registration.

Re-run `./stack login` only when auto-refresh is disabled, the refresh
itself fails, or the credentials were revoked. The most common revocation
signals are still: the proxy keeps restarting, or the dashboard's "Test
connection" fails with an auth error after previously working. From an
interactive terminal:

```bash
./stack login
```

Persistent volume caveat: the credentials volume survives `./stack restart`
and host reboots. To **rotate** credentials (e.g. switch the subscription
account), wipe the volume:

```bash
./stack down
docker volume rm mnfst_claude-proxy-credentials
./stack up
./stack login
```

(For multi-slot deployments, replace the credentials file inside the volume
rather than wiping the whole volume.)

### "Manifest sends to claude-proxy but no response comes back"

Two failure modes present identically from the UI ("send message, no
tokens render"). Diagnose by running `claude-proxy status` inside the
container (or reading the slot section of `/healthz`):

1. **CLI rejects the model name.** The Claude Code CLI 2.1.233 that
   ships in the proxy's Dockerfile only accepts the **short aliases**
   `opus`, `sonnet`, `haiku`. Versioned names (`claude-opus-4-7`,
   `claude-opus-4-8`, `claude-sonnet-4-6`, etc.) are rejected with:

   ```
   [claude-code:unrecognized_model] {"model":"opus-4-8","query_source":"sdk"}
   ```

   The subprocess exits with 0 output tokens. The proxy forwards the
   empty Anthropic-format response back (just a `message_delta` +
   `message_stop` with no `message_start` or `content_block_*`); the
   playground sees zero content deltas and renders nothing.

2. **OAuth subscription doesn't cover the versioned model.** Even
   when the CLI accepts the model name (e.g. on older CLI versions that
   did recognize `opus-4-7` etc.), the subscription itself may refuse
   the request:

   ```
   There's an issue with the selected model (opus-4-7). It may not
   exist or you may not have access to it.
   ```

   This is what your Pro subscription's tier permits — `claude-opus-5`
   and `claude-sonnet-5` (the newest short-alias models) are accessible,
   but `claude-opus-4-7` / `claude-opus-4-8` / `claude-sonnet-4-6` /
   `claude-haiku-4-5` require a higher subscription tier or an
   `ANTHROPIC_API_KEY` against `api.anthropic.com`.

**Fix for both**: override `CLAUDE_PROXY_MODELS` in `.env` to advertise
only the three short-alias models that the Pro subscription gives you
(as of August 2026):

```bash
CLAUDE_PROXY_MODELS=claude-opus-5:opus,claude-sonnet-5:sonnet,claude-haiku-4-5:haiku
```

Then `./stack restart claude-proxy`. Re-add the Anthropic provider in
Manifest if needed; it will now only show the three working models, with
names that reflect what the OAuth subscription actually serves.

To get older 4-x model versions, the path is either (a) upgrade to a
subscription tier that includes them, or (b) extend the proxy to
support an `ANTHROPIC_API_KEY` that bypasses the CLI subprocess for
specific models — that's an upstream feature request, not in scope for
the parent stack.

The root cause of the over-advertised 7-model default is upstream:
`app/config.py` ships a hardcoded 7-model fallback that includes
versioned names the bundled CLI rejects, and the OAuth subscription
may also reject versioned names it doesn't cover. This self-imposed
restriction goes away when the proxy's Dockerfile bumps its
`CLAUDE_VERSION` build arg AND the operator overrides
`CLAUDE_PROXY_MODELS` to match the new CLI's allowlist.

### Log tailing

The container is part of the `mnfst` compose project, so:

```bash
./stack logs                  # tail everything (manifest + postgres + claude-proxy + homepage)
./stack logs claude-proxy     # tail only claude-proxy
```

`./stack opencode` printout includes a debug `claude-proxy` Anthropic-kind
provider that points at `http://127.0.0.1:${CLAUDE_PROXY_PORT:-8080}/v1` — use
that from a host browser if you have `tailscale serve --bg`d the port
externally; otherwise prefer the in-network `http://claude-proxy:8080` URL from
the Manifest dashboard.

### Dashboard-side configuration

Manifest does not have a `--default-anthropic-provider` env var, so the
Anthropic-compatible entry must be added through the dashboard UI. After
`./stack up` finishes and the dashboard is reachable at
<http://localhost:2099> (or your tailnet URL):

1. Log in (or finish the `/setup` wizard if this is the first admin).
2. Open **Settings → Providers** (the exact menu label may vary; look for
   "Providers", "LLM Providers", or "Model Providers").
3. Click **Add provider**.
4. Fill in the form with these values:

   | Field | Value |
   |-------|-------|
   | Display name | `claude-proxy` (or anything you like) |
   | Base URL | `http://claude-proxy:8080` |
   | API kind / type | `anthropic` |
   | API key | _leave blank_ (subscription mode — `claude-proxy` does not accept an upstream Anthropic key) |

5. Click **Test connection** if the dashboard offers one. A successful
   test returns the `claude-proxy` health response.
6. Save the provider.

Manifest will discover the available models from the `/v1/models` endpoint
that `claude-proxy` exposes; the model list auto-populates on the next
provider refresh. The exact model IDs are whatever the upstream Claude Code
CLI reports; the dashboard's model picker will show them after the first
refresh.

If the dashboard refuses a `http://` (non-`https://`) Base URL: the
self-hosted Manifest build auto-allows private and HTTP URLs. If you are on
a managed/hosted Manifest variant, switch to a tunneled HTTPS URL or allow
the scheme via that variant's settings.

Common failure modes for the dashboard-side provider:

- **Trailing slash on the Base URL** (`http://claude-proxy:8080/`) — remove
  the trailing slash and re-save. Some upstream SDKs treat the slash as a
  different origin.
- **Wrong API kind** (`openai` instead of `anthropic`) — `claude-proxy`
  speaks Anthropic-format only. Converting from one kind to another requires
  deleting and re-adding the provider entry; Manifest does not let you edit
  the kind in place.
- **HTTP scheme blocked by a hardened dashboard** — rare on self-hosted
  builds; common on hosted variants. Self-hosted Manifest with no extra
  policy should accept `http://claude-proxy:8080`.

## Tailscale exposure (optional, for direct debug access)

`claude-proxy` does **not** publish a host port by default. The only consumer
is Manifest, which reaches it on the `frontend` bridge. If you want to use
`./stack opencode`'s debug `claude-proxy` provider (which points at
`http://127.0.0.1:${CLAUDE_PROXY_PORT:-8080}/v1` from the host), or you want
to `curl` the `/v1/messages` endpoint directly, expose the port over Tailscale
once:

```bash
tailscale serve --bg --https=443 http://localhost:8080
# or, for tailnet-only HTTP (no TLS):
tailscale serve --bg --http=8080 http://localhost:8080
```

Notes:

- **Caveat**: `claude-proxy` is bound to `0.0.0.0:8080` *inside its container*,
  not on the host. To reach it from the host loopback, you must publish a host
  port on the `claude-proxy` service. Do this ad-hoc:

  ```bash
  docker compose --project-directory . --env-file .env \
    -f manifest-local/docker-compose.yml -f compose.yml \
    --service-ports run --rm claude-proxy
  ```

  …then point `tailscale serve` at that published port. Do NOT bake a
  permanent `ports:` block into `compose.yml` — the design is in-network
  only.
- If you expose `claude-proxy` outside `localhost`, set
  `CLAUDE_PROXY_AUTH_TOKEN=$(openssl rand -hex 32)` in `.env` and pass it as
  a Bearer token on every `/v1/messages` call. The empty default trusts the
  loopback only.
- Do **not** expose `claude-proxy` via `tailscale funnel` (public internet).
  The proxy has no rate limiting beyond the per-user token bucket, and your
  subscription tokens are at stake.

## Migration notes from provider-proxy

If you're upgrading an existing install from the pre-`claude-proxy` era, the
canonical migration guide lives at
[`docs/migrating-from-provider-proxy.md`](migrating-from-provider-proxy.md).
In summary:

1. **`proxy.routes.json`** is gone. Delete it; it is no longer seeded and no
   longer read.
2. **All `PROXY_*` / `AGY_*` env vars** are gone. Drop them from your `.env`.
   `docker compose config --quiet` (run by `./stack up`) will warn about
   unknown vars but not fail.
3. **The `/agy/v1` route** is gone. Remove any Manifest provider pointing at
   `http://.../agy/v1`. Replace with the Anthropic-compatible provider entry
   described above.
4. **The host-side Node.js install** is no longer needed. The provider-proxy
   `node-pty` dependency is gone, so PTY binaries like `agy` are not pulled
   in. If you had a systemd `provider-proxy` unit, disable it
   (`systemctl disable --now provider-proxy.service` or equivalent) and
   rerun `./stack autostart enable` to install the new
   `ai-gateway-dev-stack.service` unit that covers compose-managed
   claude-proxy + Manifest + Homepage.
5. **Tailscale `svc:provider-proxy` Service** is no longer advertised. Run
   `./stack status` to confirm no stale Serve config remains; if needed,
   `tailscale serve status` to inspect.

See the full migration guide for step-by-step notes including which `npm`
packages can be removed and how to verify Manifest providers post-upgrade.
