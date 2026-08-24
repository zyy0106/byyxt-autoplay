#!/usr/bin/env bash
set -e

ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
RUNTIME="$ROOT/runtime"
NODEDIR="$RUNTIME/node"

if [ -x "$NODEDIR/bin/node" ]; then
  echo "Node.js already present in runtime folder."
  exit 0
fi

mkdir -p "$RUNTIME"

# 复用上次已解压但未重命名的目录
for d in "$RUNTIME"/node-v*; do
  if [ -d "$d" ] && [ -x "$d/bin/node" ]; then
    if [ -d "$NODEDIR" ]; then rm -rf "$NODEDIR"; fi
    mv "$d" "$NODEDIR"
    echo "Node.js reused from a previous download."
    exit 0
  fi
done

OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) P=darwin ;;
  Linux)  P=linux ;;
  *) echo "[ERROR] Unsupported OS: $OS"; exit 1 ;;
esac
case "$ARCH" in
  x86_64|amd64) A=x64 ;;
  arm64|aarch64) A=arm64 ;;
  *) echo "[ERROR] Unsupported architecture: $ARCH"; exit 1 ;;
esac

PINNED="${BYYXT_NODE_VERSION:-v24.19.0}"

download() {
  local v="$1"
  local file="node-$v-$P-$A.tar.xz"
  echo "Downloading https://nodejs.org/dist/$v/$file ..."
  curl -fL --retry 3 -o "$RUNTIME/$file" "https://nodejs.org/dist/$v/$file"
  tar -xJf "$RUNTIME/$file" -C "$RUNTIME"
  rm -f "$RUNTIME/$file"
  if [ -d "$NODEDIR" ]; then rm -rf "$NODEDIR"; fi
  mv "$RUNTIME/node-$v-$P-$A" "$NODEDIR"
  echo "Node.js $v installed to $NODEDIR"
}

if ! download "$PINNED"; then
  echo "Pinned version $PINNED failed, falling back to latest LTS..."
  VER="$(curl -fsSL --retry 3 https://nodejs.org/dist/index.json | awk '
    /"version": "v[0-9]/ { v=$0; sub(/.*"version": "/,"",v); sub(/".*/,"",v) }
    /"lts": "[A-Za-z]/ { print v; exit }
  ')"
  [ -n "$VER" ] || { echo "[ERROR] Cannot resolve Node.js version."; exit 1; }
  download "$VER"
fi
