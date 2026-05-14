# Troubleshooting

## Manifest can't reach the proxy

From inside the Manifest container, the proxy is at `host.docker.internal:${PROXY_PORT}`, not `localhost`.

Check:

- Manifest provider Base URL uses `host.docker.internal`.
- `./stack status` reports `provider-proxy: running`.
- On Linux Docker, `PROXY_BIND=0.0.0.0` and UFW allow the compose subnet; see [`cloud-deployment.md`](cloud-deployment.md).

## provider-proxy failed to start

Check `.stack/proxy.log` for the actual error.

Common causes:

- Port `9997` is already taken.
- `proxy.routes.json` is malformed.

Fix the issue and run:

```bash
./stack restart
```

`./stack` validates `proxy.routes.json` before starting the proxy and refuses to start if it is malformed.

## Homepage shows no tiles

Stack-internal tiles come from Docker labels in `compose.yml` and require the Docker socket mount. If Docker is sandboxed or the socket mount is removed, the homepage container cannot discover other containers.

Static tiles go in `homepage/services.template.yaml`; after editing, run:

```bash
./stack restart homepage
```

Do not hand-edit `homepage/.generated/services.yaml`; it is generated and gitignored.

## Tailnet group never appears

Confirm `.env` has either:

- `TAILSCALE_OAUTH_CLIENT_ID` + `TAILSCALE_OAUTH_CLIENT_SECRET`, or
- `TAILSCALE_API_KEY`

Also set `TAILSCALE_TS_DOMAIN`.

Then check:

```bash
./stack status
docker logs tailnet-poller
```

The `tailnet-poller` container should be running when tailnet credentials are set. Its logs show Tailscale API results.

## provider-proxy runs on the host instead of Docker

The proxy defaults to binding `127.0.0.1` as defense-in-depth. Containerizing it would force a Docker-network exposure it was not designed for.

Running it as a host process keeps the surface area minimal: Manifest reaches it via `host.docker.internal`. On Linux, `PROXY_BIND=0.0.0.0` widens the bind so that container-to-host hop works; the host firewall is then the public barrier. See [`cloud-deployment.md`](cloud-deployment.md).

## Run only Manifest without the proxy

Delete `proxy.routes.json` and leave `PROXY_TARGET_HOST` blank in `.env`; the proxy is skipped.

Then configure Manifest providers directly against upstream URLs.

## Data persistence

Postgres data lives in the pinned `manifest_pgdata` Docker volume. `./stack down` stops containers but never removes that volume.
