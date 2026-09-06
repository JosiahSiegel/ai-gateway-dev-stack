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
4. Create a firewall that allows only **22/tcp** inbound during setup. Do not expose ports `2099` or `2100` publicly.
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

## Reboot survival

The stack auto-recovers from a VPS reboot in two pieces:

1. **Containers** — `manifest`, `postgres`, `homepage`, and the optional `tailnet-poller` use `restart: unless-stopped`, so Docker brings them back when it starts.
2. **Systemd autostart** — even with `restart: unless-stopped`, Docker itself needs the host to be up. Install the systemd unit once to make the stack reboot-survivable:

```bash
sudo ./stack autostart enable
```

That writes `/etc/systemd/system/ai-gateway-dev-stack.service`, enables it, and starts it. The unit runs `./stack up` on boot so containers are reconciled.

Useful commands:

```bash
sudo ./stack autostart status
sudo ./stack autostart disable
```

`autostart status` warns if the installed unit drifts from what `./stack` would generate now, such as after moving the repo. Re-run `enable` to refresh it.

`bootstrap-vps.sh` and `cloud-init.yaml` both run `autostart enable` after the initial `./stack up`, so a fresh VM is reboot-survivable out of the box.

Tailscale Serve/Funnel state is persisted by `tailscaled` itself when configured with `./stack expose`; see [`tailscale.md`](tailscale.md) for Service recovery.
