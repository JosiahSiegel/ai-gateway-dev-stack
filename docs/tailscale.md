# Tailscale publishing

This stack can publish Manifest and Homepage over Tailscale without opening the app ports to the public internet.

## Recommended stack publishing

From a tailnet-connected host running the stack:

```bash
./stack expose            # interactive
./stack expose --yes      # defaults: Manifest via Funnel, Homepage as a Service
```

The command:

1. Detects the tailnet domain and this node's hostname via `tailscale status`.
2. Publishes Manifest publicly via Funnel, as a tailnet-only Service, or not at all.
3. Publishes Homepage as a tailnet Service or skips it.
4. Updates `.env` with `BETTER_AUTH_URL`, `HOMEPAGE_ALLOWED_HOSTS`, `HOMEPAGE_PUBLIC_URL`, `TAILSCALE_TS_DOMAIN`, and `TAILSCALE_HOSTNAME`.
5. Recreates affected containers so they pick up the new origins.

To take this node out of rotation:

```bash
./stack unexpose
```

Use this before bringing the same Service up on a different host; two nodes advertising the same Service split traffic.

## Tailnet policy prerequisites

Tailscale Services and Funnel are gated by the tailnet policy file. In **admin → Access controls**, merge:

```hujson
"tagOwners": { "tag:vps": ["autogroup:admin"] },
"services":  {
  "svc:manifest": { "tags": ["tag:vps"] },
  "svc:homepage": { "tags": ["tag:vps"] }
},
"nodeAttrs": [
  { "target": ["tag:vps"], "attr": ["funnel"] }
]
```

Then tag this node so it owns those Services and is allowed to use Funnel:

```bash
sudo tailscale up --ssh --advertise-tags=tag:vps
```

After that, `./stack expose` is the only command needed on subsequent hosts.

## Service access grants

Grant access to Service destinations explicitly; wildcard grants do not cover `svc:` destinations:

```hujson
{ "src": ["autogroup:member"], "dst": ["svc:homepage"], "ip": ["tcp:443"] }
```

Add equivalent grants for any other Service names you publish.

## Recovering missing Service URLs

Tailscale Serve/Funnel state is stored in `tailscaled`, not Docker or this repo. If a Service URL stops resolving or disappears after `tailscale up --reset`, changing tags, or running `./stack unexpose`, first check what the host is advertising:

```bash
tailscale serve status
```

For this stack, restore the managed URLs with:

```bash
./stack expose --manifest=funnel --homepage=service
```

## Publishing WSL-hosted apps as Services

If you publish other apps from another machine, such as a Windows + WSL dev box advertising `svc:cloudcli` or `svc:opencode`, that host also needs tag ownership and Service approval for those Service names. Services are not user-owned endpoints; the advertising device must keep a tag-based identity such as `tag:cloudcli-host` or `tag:opencode-host`.

From PowerShell on the Windows host:

```powershell
tailscale up --advertise-tags=tag:cloudcli-host,tag:opencode-host
tailscale serve --service=svc:cloudcli --bg --https=443 http://127.0.0.1:<cloudcli-port>
tailscale serve --service=svc:opencode --bg --https=443 http://127.0.0.1:<opencode-port>
tailscale serve status
```

The local URL should be whatever Windows can use to reach the WSL app, usually `http://127.0.0.1:<port>` or `http://localhost:<port>`.

A tagged device no longer carries the user's identity for Tailscale SSH policy matching. If that same host must SSH to the VPS, add an SSH rule that allows the source tag to reach the VPS tag:

```hujson
{
  "action": "accept",
  "src": ["tag:cloudcli-host", "tag:opencode-host"],
  "dst": ["tag:vps"],
  "users": ["root"]
}
```

Only add that rule if devices with those tags should have root SSH access to the VPS.

## Constraints

- Funnel ports are limited to `443`, `8443`, or `10000`; `./stack expose` defaults to `443`.
- Funnel and a Service `serve` cannot share the same port on the same node; `tailscaled` only binds the port once.
- The default `--manifest=funnel` gives Manifest a public Funnel URL. Use `--manifest=service` for a tailnet-only hostname.
- The `provider-proxy` is intentionally not exposed via Tailscale. It stays loopback-bound on the host and is only reached by Manifest through the Docker bridge.
