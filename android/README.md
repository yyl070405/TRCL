# Android 说明

## 为什么这里没有 APK

这个启动器的核心是 **Node 进程**（下载、校验、解压、拼 java 命令行、管实例），UI 只是它上面的一层网页。打包成 APK 有两条路，都不成立：

1. **WebView 套壳**：APK 里只有网页，没有 Node，启动器功能全部失效。
2. **嵌入 nodejs-mobile**：需要 Android NDK 交叉编译 libnode，再用它跑整套核心。

所以 Android 端定位是**管理端 + 交给 FCL 启动**，不是自带渲染层的启动器。

## 实际可用的 Android 包

`mc-launcher-android-termux-arm64.tar.gz` 是给 Termux 的安装包（不是 APK），在 Android 上能真正跑起来：

```bash
pkg install -y tar
cd ~
tar -xzf ~/storage/downloads/mc-launcher-android-termux-arm64.tar.gz
cd mc-launcher
bash android/start-termux.sh
# 手机 Chrome 打开 http://127.0.0.1:34120
```

首次运行会 `pkg install nodejs`。数据目录默认在 Termux 的 `~/.local/share/mc-launcher`，可用 `MC_LAUNCHER_HOME` 指到共享存储。

Chrome 菜单 →「添加到主屏幕」，可以当独立应用图标打开（已带 manifest + service worker）。

## 和 FCL 联动（能真正进游戏）

FCL（Fold Craft Launcher）自带 JRE、打过补丁的 LWJGL 和 MobileGlues/GL4ES 等渲染器。我们只需要把实例按它的格式写进 `/sdcard/FCL/.minecraft`：

```bash
# 在启动器目录下
node src/cli.js fcl-export "1.21.4 Fabric"
# 或网页界面点「导出到 FCL」
```

它会复制版本继承链、增量补齐 libraries/assets，并生成 `fclversion.cfg`，渲染器沿用你现有 FCL 实例的配置（这台机器上是 MobileGlues + Turnip）。

然后打开 FCL → 版本列表 → 选刚导出的版本 → 启动。JRE、LWJGL patch、渲染全由 FCL 负责。

注意：

- 只新增文件，不覆盖 FCL 里已有的版本；重复导出会用 merge 模式补缺
- 首次启动让 FCL 自己建 `.fabric` 之类的目录
- 如果渲染崩溃，在 FCL 的版本设置里换渲染器（MobileGlues → Zink / NGGL4ES）

## 如果一定要自带启动能力的 APK

需要对 `src/core/launch.js` 写一个 Android 后端，复用 PojavLauncher/FCL 的运行时（JVM + 图形转译），那需要独立的 Android 工程和真机调试，不在当前仓库范围内。
