# AGENTS.md — MC Launcher 工作区

> 这是给接手本工作区的 AI/开发者看的。先读完再动手。

## 这是什么

一个自己写的 Minecraft: Java 版启动器：

- `mc-launcher/`：Node.js 核心 + 本地 HTTP 服务 + 网页 UI + Electron 外壳（桌面端完整可玩）
- `mc-launcher/android-app/`：纯 Java 的 Android 工程（下载/校验/登录已完成，**运行时未实现**）
- `mc-data/`：实测用的游戏数据（1.21.4 + Fabric、Forge、存档、已下载资源）

## 运行

```bash
cd mc-launcher
npm start          # http://127.0.0.1:34120，零依赖，不用 npm install
npm test           # node --test，17 项
node src/cli.js help
```

桌面窗口：`npm install && npm run app`。打包：`npm run dist`。

## 必须知道的约定

- **零运行时依赖**：不要为了小功能引 npm 包；Node 内置模块优先。Electron/electron-builder 只放 devDependencies。
- UI 是原生 HTML/CSS/JS，无框架、无构建步骤；`ui/app.js` 是主逻辑，`ui/hud.js` 是触屏 HUD。
- 许可 **GPL-3.0-or-later**。引入 GPL 代码（如 Pojav/FCL）时保留声明并公开源码。
- 注释和用户可见文案用中文。
- 不要提交 `node_modules/`、`dist/`、`mc-data/`。

## 当前进度（2026-10-31）

已完成并验证：安装（原版/Fabric/Forge）、启动、ARM64 原生库自动替换、实例/模组/整合包、Modrinth、微软登录（代码）、导出 FCL、游戏设置 options.txt、自动语言、触屏 HUD、Linux ARM64 真机进世界。

未完成：**Android APK 的 JRE/LWJGL/GL 转译/启动桥**（见 `mc-launcher/android-app/README.md`）。


## 环境坑（都踩过）

- `pkill -f "xxx"` 会匹配到当前 bash 命令自身，把自己杀掉；用 `pkill -x java` 或锚定 `^`。
- 本机是 Android proot：没有 Android SDK（aapt2 只有 x86_64），APK 只能靠 CI。
- 系统 JRE 的 `cacerts` 可能为空，导致 Forge 安装器 TLS 报 `trustAnchors parameter must be non-empty`；`update-ca-certificates -f` 修复。
- Forge/NeoForge 安装器要求目标目录有 `launcher_profiles.json`。
- Mojang 不发 Linux ARM64 原生库，`applyArchCompat` 会替换成 Maven Central 的 `natives-linux-arm64`；jtracy 只保留主 jar。
- 触屏 HUD 依赖 `xdotool` + `scrot` + `DISPLAY`；Windows/macOS 自动隐藏。
- 占着存档锁的僵尸 java 进程会让世界显示“被另一个实例锁定”；停止逻辑已改为轮询后 SIGKILL。

## 关键文件

| 文件 | 作用 |
| --- | --- |
| `src/core/install.js` | 下载计划、ARM64 原生库替换、assets |
| `src/core/launch.js` | 启动参数拼装（纯函数） |
| `src/core/options.js` | options.txt 读写、语言映射 |
| `src/core/input.js` | HUD 按键注入（xdotool） |
| `src/core/screen.js` | 截图预览 |
| `src/core/meta.js` / `java.js` / `auth.js` / `loaders.js` | 元数据、JRE、微软登录、加载器 |
| `src/app.js` | 应用层（安装/启动/快照/设置） |
| `src/server/index.js` | HTTP API + 静态 UI |
| `ui/app.js` / `ui/hud.js` | 界面 |
| `android-app/core/` | Java 核心（28 项自检） |

## 验证方式

```bash
cd mc-launcher && npm test
cd android-app && javac --release 8 -cp libs/gson-2.11.0.jar -d /tmp/mc-core $(ls core/src/main/java/dev/mclauncher/core/*.java) core/src/test/java/dev/mclauncher/core/*.java && java -cp /tmp/mc-core:libs/gson-2.11.0.jar dev.mclauncher.core.CoreSelfTest
```
