#!/usr/bin/env bash
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if [ -x "$DIR/runtime/node/bin/node" ]; then
  export PATH="$DIR/runtime/node/bin:$PATH"
fi

NODE_OK=0
if command -v node >/dev/null 2>&1; then
  MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [ "$MAJOR" -ge 18 ] 2>/dev/null; then NODE_OK=1; fi
fi

if [ "$NODE_OK" -ne 1 ]; then
  echo "Node.js is missing or too old (v18 or newer required). Downloading portable copy (about 30MB)..."
  bash "$DIR/tools/install-node.sh" "$DIR"
  export PATH="$DIR/runtime/node/bin:$PATH"
  MAJOR="$(node -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
  if [ "$MAJOR" -lt 18 ] 2>/dev/null; then
    echo "[ERROR] Automatic download failed. Please install manually: https://nodejs.org/ (LTS, v18 or newer)"
    exit 1
  fi
  echo "Node.js ready."
fi

node start.js "$@"
