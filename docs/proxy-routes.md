# Proxy routes

Routes live in `proxy.routes.json` at the repo root. The file is gitignored and seeded from `proxy.routes.example.json` on first run.

Example:

```json
[
  { "pathPrefix": "/kimi",   "host": "api.kimi.com", "headers": { "x-app": "cli" } },
  { "pathPrefix": "/openai", "host": "api.openai.com" }
]
```

Manifest reaches a route through the host proxy:

```text
http://host.docker.internal:9997/<pathPrefix>/<upstream-path>
```

Examples:

```text
http://host.docker.internal:9997/openai/v1
http://host.docker.internal:9997/kimi/coding/v1
```

The proxy strips `pathPrefix` before forwarding, so `/kimi/coding/v1/chat/completions` becomes `https://api.kimi.com/coding/v1/chat/completions` upstream.

## Built-in routes

`/agy` is served by `provider-proxy.js` itself and should not be added to `proxy.routes.json`. It coexists with `/openai`, `/kimi`, and any other upstream routes.

Use this Manifest Base URL from Docker:

```text
http://host.docker.internal:9997/agy/v1
```

Change the prefix with `AGY_PATH_PREFIX` in `.env` if `/agy` conflicts with an upstream route.

## Supported fields

| Field | Required | Default | What it does |
|---|---|---|---|
| `pathPrefix` | yes | — | URL prefix to match, e.g. `/kimi`. First match wins. |
| `host` | yes | — | Upstream hostname. |
| `protocol` | no | `https` | `https` or `http`. |
| `port` | no | `443` / `80` | Upstream port. |
| `headers` | no | — | Headers merged on top of `PROXY_USER_AGENT` and `PROXY_EXTRA_HEADERS` for this route only. |
| `stripPrefix` | no | `true` | Remove the matched path prefix before forwarding upstream. |

## Edit and reload

1. Edit `proxy.routes.json`.
2. Run `./stack restart`.

The script validates JSON before starting the proxy and refuses to start if the routes file is malformed.

## Single-target mode

To bypass `proxy.routes.json`, set `PROXY_TARGET_HOST=<upstream>` in `.env` and optionally set `PROXY_TARGET_PROTOCOL` / `PROXY_TARGET_PORT`. The proxy forwards everything to that one host.

Use this for temporary debugging, not normal multi-provider routing. Built-in routes such as `/agy` still work independently of single-target or multi-target upstream routing.

For body-patching behavior, content-encoding handling, and the full proxy contract, see [`provider-proxy/README.md`](../provider-proxy/README.md).
