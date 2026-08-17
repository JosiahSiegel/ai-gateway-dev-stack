# claude-proxy — Stack Integration Guide

> **Status: STUB.** This file is a placeholder created during the
> `replace-provider-proxy-with-claude-proxy` migration. It contains only the
> minimal operator-facing instructions needed to get an existing stack
> pointed at the new `claude-proxy` service. A complete guide (covering
> auth, OAuth login, model list, troubleshooting, Tailscale exposure, and
> migration from `provider-proxy`) will land in a follow-up.

## Overview

`claude-proxy` is a Docker compose service that wraps the local Claude Code
CLI behind an Anthropic-compatible HTTP API. It replaces the old
`provider-proxy` host process. The service runs on the `frontend` Docker
network and is reachable from Manifest (and only from Manifest) at
`http://claude-proxy:8080`. Because Manifest is the only consumer, the
service does **not** publish a host port by default.

The `manifest` container is wired to call `http://claude-proxy:8080` for
Anthropic-format requests, but Manifest does **not** ship a built-in way to
seed a default Anthropic provider — its environment block only configures
OAuth, email, telemetry, and timeout tunables; provider entries live in
the database and must be added through the dashboard. The steps below add
that entry.

## Add the Anthropic-compatible provider in Manifest

After `./stack up` finishes and the dashboard is reachable at
`http://localhost:2099` (or your tailnet URL):

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
provider refresh. The exact model IDs are whatever the upstream Claude
Code CLI reports; the dashboard's model picker will show them after the
first refresh.

If the dashboard refuses a `http://` (non-`https://`) Base URL: the
self-hosted Manifest build auto-allows private and HTTP URLs. If you are
on a managed/hosted Manifest variant, switch to a tunneled HTTPS URL or
allow the scheme via that variant's settings.

### Authentication

`claude-proxy` requires a one-time OAuth login against the Anthropic
subscription that owns the Claude Code CLI. Run:

```bash
./stack login
```

…and complete the OAuth flow in the browser window that opens. The
credentials are persisted in the `claude-proxy-credentials` named volume,
so the login survives `./stack restart` and host reboots (when autostart
is enabled). Re-run `./stack login` if the subscription expires or is
revoked.

## Verify

From the host (only useful if you have shell access to the stack
container):

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec claude-proxy curl -fsS http://127.0.0.1:8080/healthz
```

Expected response: a JSON document with `status: ok` (or similar).

From inside any container on the `frontend` network (e.g. the `manifest`
container):

```bash
docker compose --project-directory . --env-file .env \
  -f manifest-local/docker-compose.yml -f compose.yml \
  exec manifest wget -qO- http://claude-proxy:8080/healthz
```

If the second command returns the same `ok` payload, Manifest can reach
`claude-proxy` and the dashboard's "Test connection" button will succeed.

If the dashboard's "Test connection" fails but the in-container
`curl`/`wget` succeeds, the most likely causes are:

- The dashboard's outbound HTTP filter is blocking `http://` (rare on
  self-hosted builds; common on hosted variants).
- The provider's Base URL was saved with a trailing slash
  (`http://claude-proxy:8080/`). Remove the trailing slash and re-save.
- The provider's API kind was set to `openai` instead of `anthropic`.
  `claude-proxy` speaks Anthropic-format only.

---

_More to come: OAuth flow detail, model list, environment-variable tuning,
Tailscale exposure of the `/healthz` endpoint, and migration notes from
`provider-proxy`._
