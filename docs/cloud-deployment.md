# Cloud deployment

The cheapest practical cloud deployment is a single small VPS with Docker Compose. A 2 vCPU / 4 GB RAM instance is enough for the stack plus Postgres, and it keeps the only persistent state (`manifest_pgdata`) on one disk.

Recommended baseline:

- Ubuntu 24.04
- Docker + Docker Compose plugin
- Tailscale for private access instead of public ingress
- Public firewall closed except SSH during setup

On the VM:

```bash
git clone --recurse-submodules https://github.com/JosiahSiegel/ai-gateway-dev-stack.git
cd ai-gateway-dev-stack
./stack up
```

For a fresh VM, two equivalent one-shot bootstraps are included:

- `cloud-init.yaml` — paste into your provider's user-data field.
- `bootstrap-vps.sh` — run on the VM if you prefer shell bootstrap.

## Provider notes

### Hetzner

1. Sign in at <https://console.hetzner.com/> → **Add Server**.
2. Image: **Ubuntu 24.04**. Type: **CX22** (x86) or **CAX11** (ARM, cheaper).
3. Paste `cloud-init.yaml` into the **Cloud config** field.
4. Create a firewall that allows only **22/tcp** inbound during setup. Do not expose ports `2099`, `2100`, or `9997` publicly.
5. SSH in once it boots, edit `.env`, then run `./stack restart`.

To make the VM itself a tailnet node:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh
```

### Other small VPS options

- **Contabo VPS-S** — cheapest raw value; 4 vCPU / 8 GB RAM / 200 GB SSD. Card-only, cloud-init supported. Tradeoff: noisier storage and slower provisioning.
- **Oracle Cloud Always Free** — $0 if you can get capacity. Tradeoff: capacity is inconsistent and accounts can be reaped if idle.
- **DigitalOcean Basic** — simplest setup, but more expensive.
- **Vultr** — similar to DigitalOcean in price and experience.

The same `cloud-init.yaml` and `bootstrap-vps.sh` work for all of them.

## Linux Docker host-proxy networking

Docker Desktop on macOS/Windows resolves `host.docker.internal` to the host loopback automatically. Linux Docker does not. On Linux, Manifest reaches the host proxy through the Docker bridge, so three things matter.

### 1. Bridge gateway hostname

The parent `compose.yml` maps `host.docker.internal` to the Docker bridge gateway on the Manifest service:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

### 2. Host proxy bind address

The host proxy must accept connections from the bridge interface, not just loopback. Set this in `.env`:

```bash
PROXY_BIND=0.0.0.0
```

`./stack` warns at startup whenever `PROXY_BIND` is non-loopback because the host firewall becomes the public barrier.

### 3. UFW rule order

Block the proxy port from the public side, then allow it from the compose network's subnet. The compose network is a custom Docker bridge (`br-<hash>`), not `docker0`, so `allow in on docker0` does not match.

Allow by subnet and insert the rule above the public deny:

```bash
SUBNET=$(docker network inspect mnfst_frontend \
  --format '{{(index .IPAM.Config 0).Subnet}}')

sudo ufw deny ${PROXY_PORT:-9997}/tcp
sudo ufw delete allow from "$SUBNET" to any port ${PROXY_PORT:-9997} proto tcp 2>/dev/null
sudo ufw status numbered | grep "${PROXY_PORT:-9997}/tcp"
sudo ufw insert <N> allow from "$SUBNET" to any port ${PROXY_PORT:-9997} \
  proto tcp comment 'proxy: mnfst_frontend'
sudo ufw reload
```

Verify the final order:

```text
[N]   ${PROXY_PORT}/tcp   ALLOW IN  <subnet>   # proxy: mnfst_frontend
[N+1] ${PROXY_PORT}/tcp   DENY IN   Anywhere
```

Symptoms by failure mode:

- Missing `extra_hosts`: name resolution fails inside the container.
- Loopback-only `PROXY_BIND`: the host refuses the TCP connection.
- Bad UFW order: the SYN is dropped, usually `curl: (28) Connection timed out`, not "Connection refused".

Verify the built-in agy route from the Manifest container or another container on the compose network with:

```bash
curl http://host.docker.internal:${PROXY_PORT:-9997}/agy/health
```

## Reboot survival

The stack auto-recovers from a VPS reboot in two pieces:

1. **Containers** — `manifest`, `postgres`, `claude-proxy`, `homepage`, and the optional `tailnet-poller` use `restart: unless-stopped`, so Docker brings them back when it starts.
2. **Systemd autostart** — even with `restart: unless-stopped`, Docker itself needs the host to be up. Install the systemd unit once to make the stack reboot-survivable:

```bash
sudo ./stack autostart enable
```

That writes `/etc/systemd/system/ai-gateway-dev-stack.service`, enables it, and starts it. The unit runs `./stack up` on boot, so the proxy comes back and containers are reconciled.

If you use the built-in `/agy` provider on a VPS, authenticate `agy` as the same user that runs the systemd unit. Access the setup UI over Tailscale at `http://<vps-tailnet-name>:${PROXY_PORT:-9997}/agy/`, start interactive setup, and complete the Google login URL/code shown by `agy`. Set `AGY_BIN` in `.env` if the binary is not on that user's PATH.

Useful commands:

```bash
sudo ./stack autostart status
sudo ./stack autostart disable
```

`autostart status` warns if the installed unit drifts from what `./stack` would generate now, such as after moving the repo. Re-run `enable` to refresh it.

`bootstrap-vps.sh` and `cloud-init.yaml` both run `autostart enable` after the initial `./stack up`, so a fresh VM is reboot-survivable out of the box.

Tailscale Serve/Funnel state is persisted by `tailscaled` itself when configured with `./stack expose`; see [`tailscale.md`](tailscale.md) for Service recovery.
