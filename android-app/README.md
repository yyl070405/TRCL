# MC Launcher Android（自研 Java）

目标是**不依赖 FCL 的启动器界面**，Java 侧自己管下载、实例、参数和启动，只复用开源原生库（JRE、LWJGL patch、GL 转译）。

## 当前状态

| 模块 | 状态 |
| --- | --- |
| 规则引擎（os/arch/features） | ✅ 已实现，JVM 自检通过 |
| Maven 坐标 / 库去重 | ✅ |
| 启动参数拼装（新老格式、变量替换） | ✅ |
| 下载计划（client/libraries/natives） | ✅ |
| 并发下载 + SHA1 校验 | ✅ |
| 版本清单 / 版本 JSON 拉取 | ✅ |
| 完整性校验 + 自动补全（版本文件 + assets） | ✅ |
| 资源索引解析 / objects 计划 | ✅ |
| 微软设备码登录（OAuth → XBL → XSTS → MC → profile） | ✅ 实现，未用真实账号跑通 |
| 账号存储（accounts.json） | ✅ |
| Android 工程骨架（列表 / 补全 / 登录） | ✅ 源码，未在本机编译 |
| JRE / LWJGL / GL 转译 / 启动进程 | ❌ 未实现 |

核心的 26 项自检：

```bash
cd android-app
javac --release 8 -cp libs/gson-2.11.0.jar -d /tmp/mc-core $(ls core/src/main/java/dev/mclauncher/core/*.java) core/src/test/java/dev/mclauncher/core/*.java
java -cp /tmp/mc-core:libs/gson-2.11.0.jar dev.mclauncher.core.CoreSelfTest
```

## 构建 APK

这台机器没有 Android SDK（aapt2 只有 x86_64），只能交给 CI：

- 推送后跑 `.github/workflows/android.yml`，产物是 `app-debug.apk`
- 或本地用 Android Studio 打开 `android-app/`

App 目前能「拉清单 → 下版本 JSON → 校验并补全 client/libraries/assets」，以及微软设备码登录（填了 client id 后）；**还不能启动游戏**。

## 还缺什么（按顺序）

1. **Android JRE**：普通 Linux JRE 是 glibc 的，跑不了。需要 Pojav/FCL 那类 bionic 版 JRE，首次启动下载解压到 app 私有目录
2. **LWJGL patch**：Android 没有桌面 GL/GLFW，需要替换 `lwjgl3` 的原生库和 `glfw` 实现（Boardwalk 方案）
3. **GL 转译**：GL4ES / MobileGlues / ANGLE 之一，产出 `libEGL`/`libGLESv2` 供 LWJGL 加载
4. **启动桥**：`JNI_CreateJavaVM` 或 fork `bin/java`，把 classpath、`-Dos.name=Linux`、`-Dorg.lwjgl.*.libname` 传进去
5. 模组、Forge/Fabric 安装（下载与参数拼装已具备，缺加载器安装器）

第 1-4 步是硬骨头，且必须真机调试；在当前环境里写了也无法验证，所以没有硬编。

## 许可

本项目 GPL-3.0-or-later。复用的 JRE（GPLv2+CE）、LWJGL（BSD-3）、GL4ES/MobileGlues（各自许可证）需要在发行包里保留声明。
