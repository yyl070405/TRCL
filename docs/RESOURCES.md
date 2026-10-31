# 运行时资源策略

## 原则

1. **不把运行时打进 APK**：JRE、LWJGL、GL 转译层加起来上百 MB，放进去会让安装包臃肿，也无法按设备选版本。
2. **优先自动下载**：首次启动按设备架构、游戏版本选组件，从官方 release 或镜像下载，校验 SHA-256。
3. **失败给链接**：下载不通时展示原始链接和手动放置路径，用户自己放好后点“重新检测”。
4. **可配镜像**：`mirrorBase` 字段当前为空，可填任意镜像前缀。

## 当前可用的源（2026-10 核对）

| 组件 | 版本 | 大小 | 直链 | SHA-256 |
| --- | --- | --- | --- | --- |
| MobileGlues | 2.0.0 | 10.9 MB | [GitHub release](https://github.com/MobileGL-Dev/MobileGlues-release/releases/download/V2.0.0/MobileGlues_2.0.0.apk) | `a7e1eb29…55581a` |
| Java 17 (ARM64) | 17.0.4 | 20.1 MB | [Pojav JRE](https://github.com/PojavLauncherTeam/android-openjdk-build-multiarch/releases/download/jre17-ca01427/jre17-arm64-20220817-release.tar.xz) | 无（按大小校验） |
| Java 21 (ARM64) | — | — | **无公开直链** | — |

### Java 21 的缺口

1.21.4 需要 Java 21。Pojav 的 JRE 仓库只发到 17，目前没有找到 ARM64 Android JRE 21 的公开直链。

当前的可行做法：

1. 1.20.4 及以下用 JRE 17 全自动
2. 1.21+ 标记为“需要手动提供 JRE 21”，界面给出手动放置路径
3. 若要全自动，需要自行构建 Android JRE 21，或从合法来源取得可再分发的运行时

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
