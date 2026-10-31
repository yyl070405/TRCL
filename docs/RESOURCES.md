# 运行时资源策略

## 原则

1. **不把运行时打进 APK**：JRE、LWJGL、GL 转译层加起来上百 MB，放进去会让安装包臃肿，也无法按设备选版本。
2. **优先自动下载**：首次启动按设备架构、游戏版本选组件，从官方 release 或镜像下载，校验 SHA-256。
3. **失败给链接**：下载不通时展示原始链接和手动放置路径，用户自己放好后点“重新检测”。
4. **可配镜像**：`mirrorBase` 字段当前为空，可填任意镜像前缀。

## 桌面端 Java 运行时（Zulu）

`src/core/zulu.js` 走 Azul 官方元数据接口，按本机系统与架构现查现下，不写死版本号。

- 接口：`https://api.azul.com/metadata/v1/zulu/packages/`
- 覆盖：Java 8 / 11 / 16 / 17 / 21 / 25，JRE、JDK 都有
- 平台：Windows（`zip`）、macOS 与 Linux（`tar.gz`），x64 与 aarch64
- 选择规则：按 `java_version` + `os` + `arch` + `archive_type` + `java_package_type` 查，排除 CRaC / JavaFX / musl 变体，取版本号最高的一项
- 落地目录：`runtime/zulu-<大版本>-<os>-<arch>/`，里面直接是 `bin/java`
- Zulu 取不到时退回清华 Adoptium 镜像（`mirrors.tuna.tsinghua.edu.cn/Adoptium/`）

实测（本机 Linux aarch64，2026-11-01）：

| 版本 | 实际装到的版本 | 解压后大小 | 结果 |
| --- | --- | --- | --- |
| 8 | 1.8.0_504 | 107 MB | ✅ `java -version` 正常 |
| 21 | 21.0.13 | 158 MB | ✅ |
| 25 | 25.0.5 | 190 MB | ✅ |

包名形如 `zulu21.54.107-ca-jre21.0.13-linux_aarch64.tar.gz`，JDK 版把 `-jre` 换成 `-jdk`。

**踩过的坑**：原来的 tar 解压只写文件内容、不还原权限位，JRE 装好后 `bin/java` 没有执行权限。现在按 tar 头的 mode 还原可执行位，并处理符号链接、硬链接。

## Android 运行时源（2026-11 核对）

| 组件 | 版本 | 大小 | 直链 | SHA-256 |
| --- | --- | --- | --- | --- |
| MobileGlues | 2.0.0 | 10.9 MB | [GitHub release](https://github.com/MobileGL-Dev/MobileGlues-release/releases/download/V2.0.0/MobileGlues_2.0.0.apk) | `a7e1eb29…55581a` |
| Java 17（ARM64，**macOS 构建**） | 17.0.5 | 20.1 MB | [Pojav release](https://github.com/PojavLauncherTeam/android-openjdk-build-multiarch/releases/download/jre17-ca01427/jre17-arm64-20220817-release.tar.xz) | 无 |
| Java 21（Android） | — | — | **无公开直链** | — |

### 上面那个 JRE 17 链接不能用

下载解开后里面全是 `.dylib`，`release` 文件写着 `OS_NAME="Darwin"`，是 macOS / iOS 的构建，Android 加载不了。这一点 2026-11-01 实测确认。

Android 需要的是 bionic 版运行时（ELF + `/system/bin/linker64`）。Pojav 的 Android 运行时随 `app-debug.apk`（60 MB，另有 15 MB 的 `noruntime` 版）一起发布，没有单独的可执行直链；APK 里的具体内容还没有逐个核实。

所以 Android 侧的 Java 运行时目前的状态是：**下载器骨架有、可用源没有**。要打通只有两条路：

1. 从 Pojav APK 里取 `lib/arm64-v8a/*.so` 与 assets 里的运行时。Pojav 是 GPLv3，这么做要遵守 [NOTICE.md](../NOTICE.md) 第 9 条（保留声明、标注来源、公开源码）。
2. 自己按 OpenJDK + Android 补丁构建 bionic 运行时（需要 NDK，本机做不了，只能 CI）。

桌面端（Windows / macOS / Linux）不走这条路，见上一节 Zulu。

## 代码位置

- `android-app/core/src/main/java/dev/mclauncher/core/Resources.java`：组件清单、镜像选择、手动兜底文案
- 下载复用 `Downloader`，解压后续接 `java.util.zip`（APK/zip）与 XZ 解码（JRE 的 tar.xz）

## 手动放置

```
Android/data/<包名>/files/runtime/
  mobileglues/     # 从 APK 里取 lib/arm64-v8a/*.so
  jre17/           # 解压后的 JRE 根目录（含 bin/java）
  jre21/
```

放好后点界面上的“重新检测”，不重新下载。

## 远程清单（推荐）

APK 里内置一份兜底清单；优先拉 `https://863214.xyz/runtime/manifest.json`，这样加 JRE 21/25 或换镜像不用重新发版。

```json
{
  "components": [
    {
      "id": "jre21",
      "name": "Java 21 (Android)",
      "version": "21.0.5",
      "kind": "tar.xz",
      "sha256": "…",
      "size": 21057916,
      "urls": ["https://863214.xyz/runtime/jre21-arm64.tar.xz"]
    }
  ]
}
```

- `urls` 按顺序尝试，第一个可达的胜出
- `kind`：`zip` / `apk` / `tar.xz`
- 拉不到远程清单时自动退回内置清单，不影响启动

## 为什么必须自托管

2026-10 实测：GitHub release 的大文件在这台机器上下载会被重置（curl exit 56），源码 API 正常。所以运行时不能只依赖 GitHub 直链，需要自己的域名 + 对象存储做兜底。

## 加速源（2026-10 实测）

| 前缀 | 结果 |
| --- | --- |
| `https://gh-proxy.com/` | ✅ 可用，HEAD 返回正确长度 |
| `ghfast.top` / `ghproxy.net` / `mirror.ghproxy.com` / `github.moeyy.xyz` / `gh.llkk.cc` | ❌ 连接超时 |
| `ghproxy.cc` | ❌ 证书过期 |

`Resources.expandUrls()` 会自动给 GitHub 直链加 `gh-proxy.com` 前缀，并保留直连作为备用；清单里也可以直接写自建或别的镜像地址。

实测通过代理可用：

- Pojav JRE 17 ARM64（21MB）
- MobileGlues 2.0.0 APK（11MB）
