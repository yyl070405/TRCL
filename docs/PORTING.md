# 搬到电脑上

## 1. 拷什么

| 目录/文件 | 要不要 | 说明 |
| --- | --- | --- |
| `mc-launcher/`（源码） | 要 | 不含 `node_modules/`、`dist/`，到电脑上重装依赖 |
| `mc-data/`（游戏数据） | 可选 | 已下载的版本、库、资源、实例、存档，几百 MB 起 |
| `dist/` | 不要 | 平台相关的安装包，在目标机器上重新构建 |
| `android-app/` | 可选 | 需要 Android Studio |
| `docs/` | 随源码 | 截图与说明 |

## 2. 电脑上跑起来

要求 Node.js ≥ 20（推荐 22）。

```bash
# 解压后进入目录
cd mc-launcher
npm start
# 浏览器打开 http://127.0.0.1:34120
```

桌面窗口版：

```bash
npm install            # 装 electron + electron-builder
npm run app
npm run dist           # 打当前平台的安装包
```

## 3. 把游戏数据也带过去

`mc-data` 里的 `settings.json`、`accounts.json`、`instances/`、`shared/` 都是相对路径，直接拷过去就能用。

默认数据目录：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\MCLauncher` |
| macOS | `~/Library/Application Support/MCLauncher` |
| Linux | `~/.local/share/mc-launcher` |

两种做法：

```bash
# A. 设置环境变量指向拷过来的目录
MC_LAUNCHER_HOME=/path/to/mc-data npm start        # Linux/macOS
set MC_LAUNCHER_HOME=D:\mc-data && npm start        # Windows
```

```bash
# B. 直接改名放到默认位置
mv mc-data ~/.local/share/mc-launcher
```

## 4. 迁移前要清的项

- `mc-data/settings.json` 里的 `javaPath` 是绝对路径（如 `/usr/lib/jvm/...`）。换机器后清空，让启动器重新探测，或在设置里重选。
- `accounts.json` 明文存着 access token / refresh token，别传到公开仓库；换机后可删掉重新登录。
- 实例里的 `natives/` 可以删，下次启动会按新平台重新解压。
- Linux ARM64 上自动替换的 LWJGL arm64 原生库不影响 x64，classpath 按平台重建。

## 5. 平台差异

| 功能 | Windows | macOS | Linux | Android(proot) |
| --- | --- | --- | --- | --- |
| 下载/安装/启动 | ✅ | ✅ | ✅ | ✅（需 JRE + X11） |
| 游戏设置 / 自动语言 | ✅ | ✅ | ✅ | ✅ |
| 触屏 HUD | ❌ | ❌ | 需 X11 + xdotool | ✅（Xvfb/Termux:X11） |
| 打包安装包 | 本机或 CI | 本机或 CI | 本机或 CI | 仅 Termux 包 |

## 6. 存档单独搬

实例存档在：

```
mc-data/instances/<实例id>/saves/<世界名>/
```

只搬存档的话，目标机器上先建一个同版本的实例，再把 `saves/` 目录拷进去即可。
