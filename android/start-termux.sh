#!/data/data/com.termux/files/usr/bin/bash
# 在 Termux 里安装并启动 MC Launcher。首次运行会装 nodejs（约 50MB）。
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

if ! command -v node >/dev/null 2>&1; then
  echo "==> 安装 Node.js"
  pkg update -y
  pkg install -y nodejs
fi

echo "==> Node $(node -v)"
echo "==> 启动服务（Ctrl+C 停止）"
exec node src/server/index.js
