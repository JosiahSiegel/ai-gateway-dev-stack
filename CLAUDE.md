# CLAUDE.md

Guidance for Claude Code (and other AI coding agents) working in this repo.
For the human-facing overview, quickstart, commands, and configuration table,
see [README.md](README.md). Operational runbooks live in `docs/`:

- `docs/cloud-deployment.md` — VPS setup, Linux Docker networking, UFW, and autostart.
- `docs/tailscale.md` — Serve/Funnel policy, Service recovery, WSL-hosted services, and SSH/tag tradeoffs.
- `docs/troubleshooting.md` — common failure modes and fixes.

This file only covers things that are easy to get wrong when editing code here.

## Repository shape

Parent orchestration layer for a local AI gateway stack:

- `manifest-local/` — **submodule**. Manifest dashboard + Postgres compose. Has its own `CLAUDE.md`.
- `homepage/` — **parent-owned**, not a submodule. gethomepage.dev config + an optional tailnet-poller sidecar.

**Do not modify submodule internals from the parent repo** unless the task is
explicitly about that submodule. Submodule commits are tracked separately; an
accidental edit inside a submodule leaves the parent pointing at a different
SHA than what's pushed.

## Things that are not obvious from the code

### Compose invocation

The effective compose command is always:

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml [--profile tailnet] <cmd>
```

- The parent `compose.yml` is an **overlay** — keep it minimal. Real services,
  networks, and the `manifest_pgdata` volume live in the submodule's compose
  file.
- The `name:` field is pinned to `mnfst` inside `manifest-local`. Do **not**
  override it at the parent level — that's what lets previous standalone
  installs of `manifest-local` keep the same containers and Postgres volume
  after switching to `./stack up`.
- `--profile tailnet` is added automatically by `./stack` when tailnet creds
  are present in `.env`. Don't hardcode it.

### Homepage's `services.yaml` is generated

- `homepage/services.template.yaml` is the **hand-edited** source.
- `homepage/.generated/services.yaml` is the **generated** file that gets
  bind-mounted into the container at `/app/config/services.yaml`.
- The bind mount is a **single-file** mount. If the host file doesn't exist
  before `compose up`, Docker silently creates a directory at that path and
  homepage fails to parse the YAML. `ensure_homepage_seed()` guarantees the
  file exists (empty fallback if the template is missing).
- The tailnet-poller, when enabled, **overwrites** `.generated/services.yaml`
  every tick — appending managed `- Infrastructure:` (host SSH tile, when
  `TAILSCALE_HOSTNAME` + `TAILSCALE_TS_DOMAIN` are set), `- Tailnet:`, and
  `- Tailscale Services:` groups under a marker. Do not hand-edit those groups
  in the template.
- Stack-internal tiles (Manifest, Homepage) come from **Docker labels** in
  `compose.yml`, not from any yaml — that's how we avoid touching the
  `manifest-local` submodule to add label config.

### `./stack opencode` and `./stack claude` separate stdout from stderr

Both commands emit:

- **stdout**: a single parseable JSON document (the config payload).
- **stderr**: human-readable prose with usage instructions.

This lets users redirect (`./stack opencode > opencode.json`) without
swallowing the help text, and lets CI parse the JSON without stripping
comments. **Don't move prose to stdout.**

`./stack claude` returns a JSON object with two keys, `settings` and
`settings_local`, intended to be split with `jq`. Both are needed; only the
local one carries the auth token.

### `./stack restart <svc>` uses `up --force-recreate`, not `restart`

`docker compose restart` re-runs the existing container — it does **not**
re-read labels, env vars, or volume specs. So edits to homepage labels in
`compose.yml` or values in `.env` would silently not apply. The script uses
`up -d --force-recreate --no-deps "$@"` to force a full recreate.

### Portable in-place env editing

`.env` is edited with `awk` writing to a temp file then `mv`, **not** `sed -i`.
`sed -i` has incompatible syntax between BSD (macOS) and GNU (Linux), and we
support both plus Git Bash on Windows. Keep new edits to `.env` using the
same pattern.

`env_set KEY VALUE` is the canonical helper — it replaces an existing
`KEY=` (or commented `# KEY=`) line if present, appends otherwise, and
collapses duplicates. Use it instead of hand-rolling another awk block.

### `./stack expose` and `./stack unexpose`

`expose` automates publishing this node's Manifest + Homepage via Tailscale
Serve / Funnel. It calls `tailscale status --json` to discover the tailnet
domain and node hostname, runs the appropriate `tailscale serve` /
`tailscale funnel` commands, then writes the resulting URLs back into
`.env` (`BETTER_AUTH_URL`, `HOMEPAGE_ALLOWED_HOSTS`, `HOMEPAGE_PUBLIC_URL`,
`TAILSCALE_TS_DOMAIN`, `TAILSCALE_HOSTNAME`) and recreates the affected
containers so they pick up the new origins. `./stack up` also auto-fills a
missing hostname/domain from `tailscale status` when possible. The
hostname/domain pair lets the poller add a portable `ssh://` tile for "This
host SSH" without hardcoding any user-specific FQDN in the repo.

Constraints baked into the design:

- **Funnel and Service `serve` cannot share a port on the same node.**
  `tailscaled` only binds a given external port once. So `expose` lets you
  pick *one* of `funnel` or `service` for Manifest — not both. The default
  (`--manifest=funnel`) is the public path.
- **Tailnet ACL prerequisites cannot be automated** — the `services:` and
  `nodeAttrs.funnel` blocks live in the admin console. `expose` prints the
  exact JSON to paste when a `serve` / `funnel` call fails with a
  permission error. `docs/tailscale.md` has the canonical block and
  recovery runbook.
- **Service names are hardcoded** to `svc:manifest` and `svc:homepage`.
  If you rename them, update both `cmd_expose` and `cmd_unexpose` so
  teardown still removes what setup created.
- **Serve/Funnel state lives in `tailscaled`, not Docker.** A `tailscale up
  --reset`, tag change, or `./stack unexpose` can remove Service
  advertisements while containers keep running. Diagnose with `tailscale
  serve status`; restore this stack with `./stack expose --manifest=funnel
  --homepage=service`. For external services such as `svc:cloudcli` or
  `svc:opencode`, re-run `tailscale serve --service=...` on the host that
  runs the app.
- **Tagged service hosts lose user identity for SSH ACL matching.** A
  Windows/WSL dev box advertising `svc:cloudcli` or `svc:opencode` needs a
  tag-based identity (for example `tag:cloudcli-host`), but then
  `autogroup:admin` SSH rules no longer match traffic from that device. Add
  an explicit tag-to-`tag:vps` SSH rule if the service host must SSH to the
  VPS.
- **`unexpose` does not revert `.env`.** Re-running `expose` on a new
  host is the intended migration path; reverting `.env` would just
  create churn.

`./stack unexpose` is the symmetric teardown — needed before bringing the
same Service up on a new node, since two nodes advertising one Service
splits traffic.

### `./stack autostart` and reboot survival

Two independent reboot-survival mechanisms, easy to confuse:

1. **Containers** survive via `restart: unless-stopped` set in the parent
   `compose.yml` overlay. The `manifest-local` submodule intentionally
   omits restart policies; we add them in the overlay so the standalone
   submodule stays minimal and the parent stack gets autostart by
   default. Don't push restart policies into the submodule — that breaks
   the standalone-vs-parent separation.
2. **Host stack autostart** needs systemd. `./stack autostart enable`
   writes `/etc/systemd/system/ai-gateway-dev-stack.service` and runs
   `./stack up` on boot. The unit is `Type=oneshot + RemainAfterExit=yes +
   KillMode=mixed` so the compose-managed services survive in the unit's
   cgroup after `ExecStart` returns. `ExecStop=./stack down` does clean
   teardown.

`autostart status` diffs the installed unit against the freshly-generated
content; if they differ (repo moved, user changed, node path changed),
it warns the user to re-run `enable`. Keep this drift check intact when
editing `autostart_unit_content` — silent staleness was exactly the
class of "tribal knowledge" we're trying to avoid.

`bootstrap-vps.sh` and `cloud-init.yaml` both call `./stack autostart
enable` after the initial `./stack up`, so a fresh VM is reboot-
survivable out of the box.

### `env_get` strips `\r`

`.env` may have CRLF line endings when edited on Windows. `env_get` does
`sub(/\r$/,"")` so values don't end up with a trailing `\r` that breaks
comparisons and downstream consumers. Use `env_get` rather than `grep`/`cut`
hand-rolls.

## CI gates

`.github/workflows/ci.yml` runs on every PR:

- `shellcheck -S warning` on `stack` (with `-x` so it follows sources).
- `actionlint` on workflow files.
- `yamllint` (relaxed) on `compose.yml` and `homepage/`.
- `docker compose ... config --quiet` with and without `--profile tailnet`.
- `./stack opencode` and `./stack claude` stdout must be valid JSON; the
  claude output is asserted to contain both `settings` and `settings_local`
  blocks with the right env vars. If helper output adds new providers,
  update CI assertions in lockstep.
- `node --check` on the tailnet-poller script.

If you change the shape of helper command output or rename its keys, update the
corresponding CI assertion in lockstep.

## Operational gotchas

- First-run dashboard wizard is at `http://localhost:2099/setup`.
- `./stack down` runs `compose down` but never removes the
  `manifest_pgdata` volume.
- For direct submodule work, `cd` into the submodule and read its own
  `CLAUDE.md`. Submodule commits land in that repo's history, not the parent.
