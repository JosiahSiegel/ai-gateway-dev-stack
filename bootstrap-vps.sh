#!/usr/bin/env bash
# One-shot VPS bootstrap. Same effect as cloud-init.yaml, for providers
# without cloud-init. Run on a fresh Debian/Ubuntu VM:
#
#   curl -fsSL https://raw.githubusercontent.com/JosiahSiegel/ai-gateway-dev-stack/main/bootstrap-vps.sh | sudo bash
#
# Idempotent: re-running upgrades packages and reuses the existing clone.
set -euo pipefail

repo_url="${REPO_URL:-https://github.com/JosiahSiegel/ai-gateway-dev-stack.git}"
target_user="${TARGET_USER:-${SUDO_USER:-$USER}}"
install_dir="${INSTALL_DIR:-/home/${target_user}/ai-gateway-dev-stack}"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run as root (e.g. via sudo)." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl git gnupg nodejs
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
fi

usermod -aG docker "$target_user" || true

if [ ! -d "$install_dir" ]; then
  sudo -u "$target_user" git clone --recurse-submodules "$repo_url" "$install_dir"
fi

sudo -u "$target_user" -- bash -c "cd '$install_dir' && ./stack up"
