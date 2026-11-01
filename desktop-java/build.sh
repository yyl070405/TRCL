#!/usr/bin/env bash
# 编译并运行 Java 版启动器（不需要 Node / Electron / npm）。
# 核心复用 android-app/core，界面是 Swing。
set -euo pipefail
cd "$(dirname "$0")"
ROOT=".."
GSON="$ROOT/android-app/libs/gson-2.11.0.jar"
rm -rf build
mkdir -p build
javac -encoding UTF-8 -cp "$GSON" -d build \
  $(ls "$ROOT"/android-app/core/src/main/java/dev/mclauncher/core/*.java) \
  $(ls src/main/java/dev/trcl/desktop/*.java)
echo "编译完成：desktop-java/build"
if [ "${1:-}" != "--build-only" ]; then
  shift || true
  exec java -cp "build:$GSON" dev.trcl.desktop.Main "$@"
fi
