# 交接说明（HANDOFF）

最后更新：2026-10-31

## 一句话现状

桌面端已经能完整下载、安装、启动、管模组；Android 端的管理核心（Java）已完成并通过自检，但**还不能启动游戏**；Linux ARM64（Android proot）上已经实测用本启动器进入 1.21.4 + Fabric 的世界。

## 项目结构

```
mc-launcher/
  src/core/          核心逻辑（Node，零依赖）
  src/server/        本地 HTTP API + 静态 UI
  ui/                网页界面（无框架）
  electron/          桌面外壳
  android-app/       纯 Java 的 Android 工程
  test/              node --test
  docs/              截图、迁移文档
mc-data/             实测数据（654MB）
```

## 已验证（有证据）

| 项 | 证据 |
| --- | --- |
| 原版 1.21.4 安装 | 4039 个资源文件 SHA1 校验通过 |
| Fabric 0.20.1 启动 | 进入世界，截图 `docs/android-arm64-ingame.png` |
| Forge 54.1.22 | 安装器成功，启动到 LWJGL 初始化 |
| ARM64 原生库自动替换 | 官方 JSON + 自动下载 arm64，无需手工改 |
| 游戏设置 | 写入 `lang`/`renderDistance`/`graphicsMode` 并生效 |
| 自动语言 | 删除 lang 后带 locale 启动，界面变中文 |
| 触屏 HUD | 注入 T 键打开聊天框，截图 `docs/android-hud-chat.png` |
| 微软登录（Java 核心） | 代码完整，未用真实账号跑通 |

## 未完成

1. **Android APK 运行时**：JRE（bionic）、LWJGL patch（Boardwalk）、GL 转译（MobileGlues/GL4ES）、`JNI_CreateJavaVM` 或 fork `java`
2. 微软登录真机验证（需要 Azure client id + 正版账号）
3. Quilt / NeoForge 真机验证（本机网络到 NeoForge maven 超时）
4. `.mrpack` 真实整合包验证
5. 桌面 Windows/macOS 真机验证

## 关键决策与原因

- **自研管理**：界面、实例、账号、下载全部自管；运行时按需下载。
- **ARM64 替换**：Mojang 只发 x86_64 原生库；在 `linux+arm64` 上换 Maven Central 的 `natives-linux-arm64`，jtracy 只保留主 jar（无 arm64 原生包）。
- **HUD 用 xdotool 注入**：不重写渲染层，直接给 X11 发键鼠事件；画面用 scrot 截图轮询（约 1.4fps）。
- **语言只写一次**：`options.txt` 没有 `lang` 才按 `navigator.language` 写，避免覆盖玩家选择。
- **零依赖**：网络下载、ZIP 解压、HTTP 全部手写，避免供应链与安装体积。

## 已知问题

- `dist/` 里的安装包是 2026-10-30 的，**不含**之后的游戏设置、HUD；需要重新 `npm run dist`。
- 触屏 HUD 仅在 Linux + X11 可用；Windows/macOS 会隐藏。
- 停止游戏偶发留下占存档锁的进程，已改为轮询 6 秒后 SIGKILL，但未做大规模复测。
- `accounts.json` 明文存 token（当前只有离线账号）。

## 验证命令

```bash
cd mc-launcher && npm test
cd android-app && javac --release 8 -cp libs/gson-2.11.0.jar -d /tmp/mc-core $(ls core/src/main/java/dev/mclauncher/core/*.java) core/src/test/java/dev/mclauncher/core/*.java && java -cp /tmp/mc-core:libs/gson-2.11.0.jar dev.mclauncher.core.CoreSelfTest
```


## 环境

- 开发机：Android 14 手机，proot Ubuntu 24.04，arm64，Node 24，JDK 21
- Xvfb :99 + Mesa llvmpipe（软件 OpenGL 4.5）
- 域名 863214.xyz 暂放 Cloudflare，未启用
