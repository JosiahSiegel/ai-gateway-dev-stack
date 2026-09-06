# Troubleshooting

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

## Data persistence

Postgres data lives in the pinned `manifest_pgdata` Docker volume. `./stack down` stops containers but never removes that volume.
