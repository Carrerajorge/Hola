#!/usr/bin/env bash
set -euo pipefail

REPO="Carrerajorge/Hola"
BIN_DIR="${BIN_DIR:-/usr/local/bin}"
OS="$(uname -s)"
ARCH="$(uname -m)"

if [ "$ARCH" != "x86_64" ] && [ "$ARCH" != "amd64" ]; then
  echo "Unsupported arch: $ARCH (only x86_64 for now)" >&2
  exit 1
fi

asset=""
if [ "$OS" = "Linux" ]; then
  asset="iliagpt-node-linux"
elif [ "$OS" = "Darwin" ]; then
  asset="iliagpt-node-macos"
else
  echo "Unsupported OS for this installer: $OS" >&2
  echo "Use Windows installer or npm install -g @carrerajorge/iliagpt-node" >&2
  exit 1
fi

api="https://api.github.com/repos/${REPO}/releases/latest"
url="$(curl -fsSL "$api" | python3 - <<PY
import json,sys
j=json.load(sys.stdin)
assets=j.get('assets',[])
name=sys.argv[1]
for a in assets:
  if a.get('name')==name:
    print(a.get('browser_download_url',''))
    break
PY
"$asset")"

if [ -z "$url" ]; then
  echo "Could not find asset $asset in latest release. Did you tag iliagpt-node-vX.Y.Z ?" >&2
  exit 1
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

curl -fL "$url" -o "$tmp"
chmod +x "$tmp"

sudo mkdir -p "$BIN_DIR"
sudo mv "$tmp" "$BIN_DIR/iliagpt-node"

echo "Installed: $BIN_DIR/iliagpt-node"
iliagpt-node --help || true
