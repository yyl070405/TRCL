# 功能状态

只记录核实过的状态：✅ 已实现并验证，⚠️ 已实现未验证，❌ 未实现。

## 版本与加载器

| 能力 | 状态 |
| --- | --- |
| 原版全版本、快照、旧版 | ✅ |
| Fabric | ✅ |
| Quilt | ⚠️ 代码完整，未跑通 |
| Forge | ✅ 安装并启动到 LWJGL 初始化 |
| NeoForge | ⚠️ 代码完整，本机到 maven 超时 |
| LiteLoader、OptiFine、Cleanroom | ❌ |

## 账号

| 能力 | 状态 |
| --- | --- |
| 离线账号 | ✅ |
| 微软设备码登录 | ⚠️ 代码完整，未用真实账号跑通 |
| 第三方外置登录（authlib-injector） | ❌ |

## 内容

| 能力 | 状态 |
| --- | --- |
| Modrinth 搜索 / 安装 / 必要依赖 | ✅ |
| 模组启停、删除 | ✅ |
| 模组更新、冲突检测 | ❌ |
| Modrinth 整合包 | ⚠️ 代码完整，未用真实包 |
| CurseForge 整合包 | ❌ 需要 API key |

## 实例与存档

| 能力 | 状态 |
| --- | --- |
| 多实例隔离、内存 / 窗口 / JVM 参数 | ✅ |
| 导出为 .mrpack / MultiMC 实例 | ✅ |
| 实例导入导出、备份、复制 | ❌ |
| 世界列表、存档备份 | ❌ |

## 下载

| 能力 | 状态 |
| --- | --- |
| 官方源、断点续传、SHA1 校验、缺失补全 | ✅ |
| BMCLAPI / 自建镜像 | ⚠️ 字段预留，未启用 |
| 并发下载 | ✅ |
| 多源竞速 | ❌ |

## 界面

| 能力 | 状态 |
| --- | --- |
| 实例侧栏、启动 / 安装 / 导出 / 模组 / 设置 | ✅ |
| 联网主页（自填 JSON 公告，纯文本渲染） | ⚠️ 代码完成，未接入真实公告源 |
| 触屏 HUD 键位布局 | ✅ Linux 真机 |

## 启动

| 能力 | 状态 |
| --- | --- |
| Java 探测、自动下载运行时（Zulu 8/11/16/17/21/25，或 Oracle JDK） | ✅ 真机装过 Zulu 8/21/25 |
| 启动参数拼装（新旧格式） | ✅ |
| Linux ARM64 原生库自动替换 | ✅ 真机进世界 |
| 崩溃分析 | ❌ |

## 平台

| 能力 | 状态 |
| --- | --- |
| Windows / macOS / Linux 打包 | ⚠️ 已出包，未在对应系统启动验证 |
| Linux ARM64（proot / Termux） | ✅ |
| Android APK | ⚠️ 核心完成，运行时未接 |

## 界面与体验

| 能力 | 状态 |
| --- | --- |
| 实例 / 模组 / 设置 / 日志界面 | ✅ |
| 游戏设置（options.txt）、自动语言 | ✅ |
| 触屏 HUD、屏幕预览 | ✅ 仅 X11 |
| 22 种语言映射 | ✅ |
| 自动更新 | ❌ |
| 插件机制 | ❌ |

## 验证方式

```bash
cd mc-launcher && npm test
cd android-app && javac --release 8 -cp libs/gson-2.11.0.jar -d /tmp/mc-core $(ls core/src/main/java/dev/mclauncher/core/*.java) core/src/test/java/dev/mclauncher/core/*.java && java -cp /tmp/mc-core:libs/gson-2.11.0.jar dev.mclauncher.core.CoreSelfTest
```
