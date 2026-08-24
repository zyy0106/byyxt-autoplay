#!/usr/bin/env bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "[错误] 未检测到 Node.js,请先安装: https://nodejs.org/"
  exit 1
fi
node start.js "$@"
