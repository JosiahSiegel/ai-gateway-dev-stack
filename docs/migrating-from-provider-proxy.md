# Migrating from `provider-proxy` to `claude-proxy`

This guide walks an existing `ai-gateway-dev-stack` install through the upgrade
that replaces the host-side `provider-proxy` Node.js process with the in-stack
`claude-proxy` Docker compose service. If you are setting up the stack fresh,
you do **not** need this guide — start at the [Quickstart](../README.md#quickstart).

## Overview

The `provider-proxy` module — a Node.js reverse proxy that bound
`127.0.0.1:9997` on the host, read `proxy.routes.json` for upstream routes, and
hosted the built-in `/agy/v1` Antigravity route — is **gone**. Its replacement
is `claude-proxy`, a self-contained Python/FastAPI Docker compose service that
sits on the shared `frontend` Docker network and is reached in-network by
Manifest at `http://claude-proxy:8080`. The migration deletes files, scrubs
`PROXY_*` / `AGY_*` vars from `.env`, adds the new `CLAUDE_PROXY_*` block,
swaps the host-side Node install for one OAuth login, and re-points Manifest at
the new Anthropic-compatible provider.

For a high-level summary (and the operator-facing integration reference), see
[`docs/claude-proxy.md`](claude-proxy.md). For the canonical Claude Code CLI
+ OAuth surface, see [`claude-proxy/README.md`](../claude-proxy/README.md).
For the user-facing introduction, see the [README](../README.md).

## Before you start

- **Docker** with Compose V2 (Docker Desktop on macOS/Windows is fine; Linux
  needs the `docker compose` plugin).
- **Access to the Manifest dashboard** at <http://localhost:2099> (or your
  tailnet URL) — you will add a new provider entry during the migration.
- **A real terminal** capable of running an interactive OAuth flow. `./stack
  login` refuses to proceed if stdin is not a TTY; see
  [Step 6](#step-6-authenticate-claude-code-oauth).
- **A backup of your existing `.env`**. Even though the migration rewrites only
  the proxy-related keys, take a snapshot:

  ```bash
  cp .env .env.bak-$(date +%Y%m%d-%H%M%S)
  ```

- **(If you use Tailscale)** a `tailscale` binary on the host. `./stack
  unexpose` cleans up the legacy `svc:provider-proxy` Service binding in
  [Step 9](#step-9-update-tailscale-servefunnel).

The whole migration takes about 10 minutes end-to-end on a fresh host: pull
the new code, build the new image, bring the stack up, complete the one-time
OAuth login, and add the new provider in Manifest.

## Step 1: Update the repo

Before pulling, **stop the old host proxy** so the Node process does not
fight the new compose-managed `claude-proxy` for the same logical role:

```bash
./stack down
```

If you installed the host proxy via systemd manually (outside
`./stack autostart enable`), disable it now:

```bash
systemctl disable --now provider-proxy.service 2>/dev/null || true
```

(If your existing install used `./stack autostart enable`, the autostart
helper wrote a unit named `ai-gateway-dev-stack.service`; that unit is
re-written by [Step 2](#step-2-delete-the-old-proxy-files), so leave it for
now and rerun `./stack autostart enable` at the end.)

Then pull the new parent repo and its submodules:

```bash
git pull
git submodule update --init --recursive
```

The parent brings in the new `claude-proxy/` submodule. You should see:

- A new `claude-proxy/` directory at the repo root (a freshly cloned submodule).
- A `manifest-local/` pointer that has not changed — your existing Manifest
  install is preserved (same `mnfst` compose project, same `manifest_pgdata`
  Postgres volume).

Verify the submodule is initialized:

```bash
ls claude-proxy/Dockerfile   # should exist
```

If `claude-proxy/` is empty, the `--init --recursive` flag was not enough;
run:

```bash
git submodule update --init --recursive --force
```

## Step 2: Delete the old proxy files

The migration removes two files from the repo and one systemd unit (if
applicable).

```bash
# 1. The gitignored runtime file — was never tracked, just unlinked.
rm -f proxy.routes.json

# 2. The tracked example — already removed in earlier prep work.
ls proxy.routes.example.json 2>/dev/null \
  && git rm proxy.routes.example.json \
  || echo "proxy.routes.example.json already removed (expected)"
```

If you installed a host-side `provider-proxy` systemd unit manually (i.e. you
wrote `/etc/systemd/system/provider-proxy.service` yourself, outside of
`./stack autostart`), stop and disable it now:

```bash
sudo systemctl disable --now provider-proxy.service
sudo rm -f /etc/systemd/system/provider-proxy.service
sudo systemctl daemon-reload
```

If you used `./stack autostart enable` for the old install, the unit on disk
is `ai-gateway-dev-stack.service`. Re-run the helper at the end of the
migration and it will install the rewritten unit:

```bash
./stack autostart enable    # do this AFTER Step 5 so the unit covers the new stack
```

## Step 3: Edit `.env`

Two changes: drop the old `PROXY_*` and `AGY_*` keys, and add the new
`CLAUDE_PROXY_*` block.

### Drop old keys (portable, no `sed -i`)

`sed -i` has incompatible syntax between BSD (macOS) and GNU (Linux); the
canonical pattern used by `./stack` is `awk > tmp && mv`. Run this loop to
delete every line starting with `PROXY_` or `AGY_`:

```bash
grep -E '^(PROXY|AGY)_' .env | while IFS='=' read -r key _; do
  awk -v k="$key" '
    BEGIN{done=0}
    {sub(/\r$/,"")}
    $1==k {done=1; next}
    {print}
  ' .env > .env.tmp && mv .env.tmp .env
done
```

After running, `grep -E '^(PROXY|AGY)_' .env` should return nothing. If it
does, the loop missed a key (usually one wrapped in quotes or with a leading
whitespace); inspect manually and re-run.

### Add the new `CLAUDE_PROXY_*` block

The canonical block lives in `.env.example`. Copy the relevant section:

```bash
grep -A 100 '^CLAUDE_PROXY_HOST=' .env.example | grep -B 100 '^# --- ' \
  > .env.claude-proxy-snippet
# review the snippet, then append:
cat .env.claude-proxy-snippet >> .env
rm .env.claude-proxy-snippet
```

At minimum, set:

```bash
CLAUDE_PROXY_HOST=0.0.0.0
CLAUDE_PROXY_PORT=8080
CLAUDE_PROXY_LOG_LEVEL=INFO
```

**Only set `CLAUDE_PROXY_AUTH_TOKEN` if you intend to expose `claude-proxy`
to non-localhost callers** (e.g. tailnet Serve for direct debug). For a
single-user dev host, leave it empty — the default trusts the container
loopback only:

```bash
# OPTIONAL — only if you want non-localhost clients to reach claude-proxy.
# CLAUDE_PROXY_AUTH_TOKEN=$(openssl rand -hex 32)
```

For the full annotated list (14 vars), see the
[Configuration reference](claude-proxy.md#configuration-reference) in
`docs/claude-proxy.md` or `.env.example` directly.

## Step 4: Build the new image

`claude-proxy` ships a Dockerfile but no prebuilt registry image — the parent
stack builds it locally. Run from the submodule:

```bash
cd claude-proxy && make build && cd ..
```

`make build` is a `docker compose build` against the submodule's own compose
file (not the parent overlay). It pulls the pinned Claude Code CLI version
(`CLAUDE_VERSION=2.1.233`) and bakes it into the image. If you are offline,
this step requires the upstream `claude-code` tarball to already be cached
locally — see [`claude-proxy/README.md`](../claude-proxy/README.md).

Re-run `make build` only when:

- the `CLAUDE_VERSION` pin in the submodule Dockerfile changes (after a
  `./stack pull` that updates the submodule), or
- code inside `claude-proxy/` changes (image rebuild after a code update).

For a routine `./stack pull` + `./stack restart`, you do not need to re-run
`make build`.

## Step 5: Bring up the new stack

```bash
./stack up
```

`./stack up` will, in order:

1. Initialize the `manifest-local` and `claude-proxy` submodules if needed.
2. Read `.env`, interpolate `${CLAUDE_PROXY_*:-default}` into the parent
   `compose.yml` overlay.
3. Validate the effective compose config (`docker compose ... config
   --quiet`).
4. Bring up Manifest + Postgres + claude-proxy + Homepage via Docker Compose.
5. Print a one-time hint to run `./stack login`.

The `claude-proxy` container joins the `frontend` Docker network alongside
Manifest. It does **not** publish a host port; the only consumer is Manifest
at `http://claude-proxy:8080`.

After the bring-up banner prints "stack up", verify the container is
running:

```bash
./stack status claude-proxy
# or
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  ps claude-proxy
```

You should see one row with `State: Up` and a healthy status (the
Dockerfile's healthcheck pings `curl -fsS http://127.0.0.1:8080/healthz`).

Now is the right time to re-run `./stack autostart enable` so the systemd
unit covers the new stack:

```bash
./stack autostart enable
```

(The unit description was rewritten to read "Manifest + claude-proxy +
Homepage".)

## Step 6: Authenticate Claude Code OAuth

> **Do not skip this step.** The proxy cannot talk to Anthropic without
> OAuth credentials. Until you complete this step, Manifest's "Test
> connection" against `claude-proxy` returns 401, and the
> `claude-proxy-credentials` named volume is empty.

```bash
./stack login
```

This opens an interactive Claude Code OAuth flow **inside the `claude-proxy`
container** — your terminal becomes the OAuth client, the browser window is
yours. `./stack login` is a thin wrapper around
`docker compose ... exec -it claude-proxy claude-proxy login`. The upstream
alternative is:

```bash
cd claude-proxy && make login
```

Both commands do the same thing — `./stack login` is the canonical surface,
`make login` is the submodule's Makefile target.

The credentials are persisted to
`/home/claude-proxy/.claude/.credentials.json` inside the
`claude-proxy-credentials` named volume, which survives `./stack restart`
and host reboots (when autostart is enabled).

The flow is interactive — it requires a TTY. If you are in CI or scripting
the migration, use:

```bash
./stack login --no-tty
```

…to print the manual-instructions variant. The interactive form will not
work without a real terminal.

Re-run `./stack login` whenever:

- the subscription expires or is rotated, or
- you wipe the credentials volume to switch accounts (see [OAuth expiry /
  re-auth](claude-proxy.md#oauth-expiry--re-auth) in `docs/claude-proxy.md`).

## Step 7: Add the Anthropic-compatible provider in Manifest

Open the dashboard at <http://localhost:2099> (or your tailnet URL). The
`manifest-local` submodule does **not** ship an env var to seed a default
Anthropic provider — this step is mandatory.

1. Log in (or finish the `/setup` wizard if this is the first admin).
2. Open **Settings → Providers** (look for "Providers", "LLM Providers", or
   "Model Providers" depending on your Manifest build).
3. Click **Add provider**.
4. Fill in:

   | Field | Value |
   |-------|-------|
   | Display name | `claude-proxy` (or anything you like) |
   | Base URL | `http://claude-proxy:8080` |
   | API kind | `anthropic` |
   | API key | _leave blank_ (subscription mode) |

5. Click **Test connection** if the dashboard offers one. A successful test
   returns the `claude-proxy` health response — i.e. the same JSON
   `curl http://claude-proxy:8080/healthz` returns.
6. Save the provider.

If you previously had OpenAI / Kimi / `/agy/v1` providers, remove them —
those routes no longer exist. The old `http://127.0.0.1:9997/agy/v1`
Antigravity path is gone with `provider-proxy`. Replace it with the new
`http://claude-proxy:8080` Anthropic-compatible entry.

If the dashboard refuses `http://` (non-`https://`) as the Base URL, the
self-hosted Manifest build auto-allows private HTTP URLs; if you are on a
managed variant, switch to a tunneled HTTPS URL or allow the scheme via
that variant's settings. See
[Common failure modes for the dashboard-side provider](claude-proxy.md#common-failure-modes-for-the-dashboard-side-provider)
in `docs/claude-proxy.md`.

## Step 8: Update client configs

Any client (OpenCode, Claude Code) that pointed at the old host proxy must
be re-pointed. The previous URLs are **no longer reachable**:

| Old URL | Status |
|---|---|
| `http://127.0.0.1:9997/openai/v1` | _Gone_ — `provider-proxy` host process is no longer running. |
| `http://127.0.0.1:9997/agy/v1` | _Gone_ — the `/agy/v1` route no longer exists. |

Regenerate the helper snippets to pick up the new defaults:

```bash
./stack opencode > ~/.config/opencode/opencode.json
mkdir -p .claude
./stack claude | jq .settings       > .claude/settings.json
./stack claude | jq .settings_local > .claude/settings.local.json
# then edit settings.local.json and replace the token placeholder
```

Both helpers emit a single parseable JSON document on **stdout**; prose
instructions go to **stderr**, so you can redirect cleanly.

The new `./stack opencode` snippet includes a debug `claude-proxy`
Anthropic-kind provider pointing at
`http://127.0.0.1:${CLAUDE_PROXY_PORT:-8080}/v1` — this works **only if you
have published the host port** (which the default does **not**). To use it
from the host, see the ad-hoc pattern in
[Tailscale exposure](claude-proxy.md#tailscale-exposure-optional-for-direct-debug-access).
For routine use, the Manifest URL is the canonical client target.

## Step 9: Update Tailscale Serve/Funnel

If you previously advertised `provider-proxy` over Tailscale (e.g. via
`./stack expose --manifest=funnel`, which wired the legacy
`svc:provider-proxy` Service), clean up the stale Serve config:

```bash
./stack unexpose
```

This removes any leftover Tailscale Serve/Funnel state from the previous
install. `./stack status` should report no Serve bindings for this node
afterward; double-check with `tailscale serve status`.

`claude-proxy` is **not** exposed over Tailscale by default — Manifest is the
only consumer, and it reaches the proxy on the in-network `frontend` bridge.
If you want direct debug access from a host browser (e.g. to use the
`./stack opencode` debug `claude-proxy` provider), see the ad-hoc
[Tailscale exposure](claude-proxy.md#tailscale-exposure-optional-for-direct-debug-access)
section in `docs/claude-proxy.md`. Do **not** publish `claude-proxy` via
`tailscale funnel` (public internet) — the proxy's per-user rate limiting
is a token bucket, and your subscription tokens are at stake.

## Step 10: Verify

Three end-to-end checks. Run all three.

### 1. `claude-proxy` is reachable in-network

From inside Manifest's container, hit the `frontend`-bridge address:

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec manifest wget -qO- http://claude-proxy:8080/healthz
```

A healthy response returns a small JSON object (e.g.
`{"status":"ok",...}`). If you see `wget: bad address 'claude-proxy'` or a
timeout, the `claude-proxy` container is not on the `frontend` network —
re-run `./stack up` and re-check.

### 2. OAuth credentials are persisted

After completing `./stack login`, the credentials file should exist inside
the `claude-proxy-credentials` named volume:

```bash
docker exec claude-proxy ls /home/claude-proxy/.claude/
```

You should see (at minimum):

```text
.credentials.json
```

If the file is missing, OAuth did not complete successfully. Re-run
`./stack login` from an interactive terminal and check the OAuth URL printed
during the flow.

### 3. A real Claude Code session through Manifest returns a Claude response

The most direct end-to-end check is to send a `curl` from inside Manifest's
container that proxies through to `claude-proxy`:

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec manifest \
    wget -qO- http://claude-proxy:8080/v1/models
```

A healthy response lists the Claude model IDs that `claude-proxy` exposes
(whatever the upstream Claude Code CLI reports). If `v1/models` returns a
non-empty JSON array, the OAuth subscription is wired and Manifest will be
able to broker requests through it.

For a true smoke test, use the Manifest dashboard's chat UI (the
`http://localhost:2099` provider entry added in
[Step 7](#step-7-add-the-anthropic-compatible-provider-in-manifest)) and
send a prompt to a Claude model — the response should be a normal Claude
answer.

## Rollback

If something goes wrong and you need to roll back to the pre-migration
`provider-proxy` install, the procedure is approximate: the `provider-proxy`
submodule is no longer in the parent repo, so the "true" rollback is to
restore the parent to a pre-migration commit. The lightweight version, when
the issue is just a misconfigured `claude-proxy`, is to:

1. Restore `.env` from the backup:

   ```bash
   cp .env.bak-YYYYMMDD-HHMMSS .env
   ```

2. Roll the parent repo back to the previous tag or commit:

   ```bash
   git checkout main               # or the pre-migration tag
   git submodule update --init --recursive
   ```

3. Bring the old stack back up:

   ```bash
   ./stack up
   ./stack restart provider-proxy # the old host-proxy process is restored
   ```

4. Re-add the Manifest provider pointing at
   `http://host.docker.internal:9997/...` if you rolled all the way back.

**Caveat**: if you deleted `proxy.routes.json` and `proxy.routes.example.json`
on the pre-migration tree (these are gitignored and tracked, respectively),
recreate them — `proxy.routes.example.json` is restored automatically by
`./stack up` via `ensure_routes()`; `proxy.routes.json` seeds from it on
first run.

The cleanest rollback path is to roll back the entire parent repo to a
pre-migration commit, not to attempt a partial revert. `provider-proxy` is
not a runtime dependency of `claude-proxy` — the two have separate lifecycle
paths — but the parent repo no longer carries the `provider-proxy` submodule
pointer, so a partial revert leaves dangling references.