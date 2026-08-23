# Troubleshooting

## Manifest can't reach the proxy

From inside the Manifest container, the proxy is at `host.docker.internal:${PROXY_PORT}`, not `localhost`.

Check:

- Manifest provider Base URL uses `host.docker.internal`, for example `http://host.docker.internal:${PROXY_PORT}/agy/v1` for the built-in agy provider.
- `./stack status` reports `claude-proxy: Up (healthy)`.
- On Linux Docker, `PROXY_BIND=0.0.0.0` and UFW allow the compose subnet; see [`cloud-deployment.md`](cloud-deployment.md).

## claude-proxy failed to start

Check the container logs for the actual error:

```bash
docker logs claude-proxy
```

Common causes:

- Container-internal port `8080` is already taken by another service inside the compose network.
- `claude-proxy` container is failing its healthcheck. Run `docker inspect --format '{{json .State.Health}}' claude-proxy` for the most recent probe output.

Fix the issue and restart just the affected service:

```bash
./stack restart claude-proxy
```

If the container exits repeatedly with a stale OAuth session, run `./stack login` to re-authenticate.

## Built-in agy provider hangs or returns 502

The `/agy` route runs the local Antigravity CLI as a subprocess, so it must work for the same OS user running the host proxy.

Check:

- `agy --print "Reply with OK"` works in the same terminal/account that runs `./stack` or the systemd unit.
- On a VPS, the setup UI is reachable over Tailscale at `http://<vps-tailnet-name>:${PROXY_PORT}/agy/` and the Google login is completed for that same OS user.
- Manifest uses `http://host.docker.internal:${PROXY_PORT}/agy/v1`, not `localhost`, when running in Docker.
- PTY mode stays enabled when available; use `AGY_USE_PTY=0` only for debugging plain-pipe behavior.
- `.stack/proxy.log` shows the resolved `agy` binary, PTY status, request path, and subprocess errors. Useful lines include `Built-in agy PTY: enabled`, `[agy] incoming ...`, and `[agy] chat request start...`.
- From the host, `curl http://127.0.0.1:${PROXY_PORT:-9997}/agy/health` should return JSON.
- From a container, `curl http://host.docker.internal:${PROXY_PORT:-9997}/agy/health` should return JSON.
- If the UI is path-mounted through Tailscale Serve, check whether requests arrive as `/agy/...` or `/agy/agy/...` in `.stack/proxy.log`.

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

## Run only Manifest without the proxy

Delete `proxy.routes.json` and leave `PROXY_TARGET_HOST` blank in `.env`; the proxy is skipped.

Then configure Manifest providers directly against upstream URLs.

## Data persistence

Postgres data lives in the pinned `manifest_pgdata` Docker volume. `./stack down` stops containers but never removes that volume.
