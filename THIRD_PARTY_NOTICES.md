# 第三方声明

## 本项目包含的依赖

| 组件 | 许可证 | 用途 |
| --- | --- | --- |
| Node.js | MIT | 运行时 |
| Electron | MIT | 桌面外壳 |
| electron-builder | MIT | 打包 |
| 本项目自身代码 | GPL-3.0-or-later | — |

这些依赖都以独立进程或库的形式使用，未修改其源码。

## 不包含的内容

- **Minecraft 游戏文件**：client.jar、libraries、assets 都是运行时从 Mojang 官方（或用户配置的镜像）下载，不随本项目分发。使用游戏需遵守 Minecraft EULA。
- **PojavLauncher**：本项目**没有**包含 PojavLauncher 的任何代码。PojavLauncher 是 GPLv3 项目。

## 如果以后接入 PojavLauncher

PojavLauncher 采用 GPLv3。任何把它的代码、JVM、图形转译层打进同一安装包的行为，都会让整个分发物落入 GPLv3：

1. 必须公开完整对应源码（含你自己的修改）
2. 必须保留原作者的版权声明与许可证
3. 不能附加额外限制

本项目已采用 GPL-3.0-or-later，届时不需要改许可证，但仍需在发行页提供源码地址和修改说明。

## 商标

Minecraft 是 Mojang Studios / Microsoft 的商标。本项目与 Mojang 无关，名称里的 "MC Launcher" 仅作描述用途。
