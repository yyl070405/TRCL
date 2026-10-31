# 来源与许可声明

本声明适用于 TRCL（Tiny Runtime Craft Launcher）的源码、安装包、文档与发行页面。**任何分发或使用本项目的个人与组织，均视为已阅读本声明。**

## 1. 版权

Copyright © 2026 yyl070405

- 项目名：TRCL · Tiny Runtime Craft Launcher
- 源码：https://github.com/yyl070405/TRCL
- 许可证：**GPL-3.0-or-later**，全文见 [LICENSE](LICENSE)
- 第三方组件的版权归各自作者所有，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 2. 不隶属声明

本项目是个人独立开发的第三方启动器，**非官方**，与下列主体均无隶属、赞助、授权或背书关系：

Mojang Studios、Microsoft、Fabric、Quilt、Forge、NeoForge、Modrinth、PojavLauncher、HMCL、PCL。

README 中提到的 HMCL / PCL 仅表示产品形态与交互思路上的参照，不包含其任何代码或资源。

## 3. 商标

- Minecraft 是 Mojang Studios / Microsoft 的商标。本项目在描述兼容对象时使用该名称，属指示性使用，不表示商标权人认可本项目。
- 其他出现的名称、标志、商标归各自所有者，仅用于说明用途。

## 4. 游戏文件、账号与数据

- **不包含游戏文件**：client jar、libraries、assets、原生库都是运行时从官方或用户配置的镜像下载，不随本项目分发。
- **需要合法副本**：使用 Minecraft 客户端须自行购买并遵守 [Minecraft EULA](https://www.minecraft.net/eula)。本项目不是绕过正版验证的工具；微软登录走官方 OAuth 设备码流程，密码不经过本项目。
- **账号数据只在本机**：微软登录获得的访问令牌与账号信息保存在本机数据目录的 `accounts.json`，不上传至本项目或任何第三方服务器。数据目录位置见 README（可用环境变量 `MC_LAUNCHER_HOME` 覆盖）。
- **无遥测**：代码中没有统计、埋点、崩溃上报或用户行为收集。
- **联网目标**：启动器发出的请求只用于取版本元数据、下载游戏资源、登录与更新，涉及的域名：

  | 用途 | 域名 |
  | --- | --- |
  | 版本与资源清单 | `piston-meta.mojang.com`、`resources.download.minecraft.net`、`libraries.minecraft.net` |
  | 加载器 | `meta.fabricmc.net`、`meta.quiltmc.org`、`maven.minecraftforge.net`、`maven.neoforged.net`、`files.minecraftforge.net` |
  | 模组与整合包 | `api.modrinth.com`、`cdn.modrinth.com` |
  | 登录 | `login.microsoftonline.com`、`user.auth.xboxlive.com`、`xsts.auth.xboxlive.com`、`api.minecraftservices.com` |
  | Java 运行时 | `api.adoptium.net`、`mirrors.tuna.tsinghua.edu.cn` |
  | 镜像（可选，可在设置中修改） | `bmclapi2.bangbang93.com`、自建镜像域名 |
  | 运行时包与更新 | `github.com`、`gh-proxy.com`（Android 端下载兜底）及自建分发域名 |

  这些第三方服务可能按自身隐私政策记录 IP、User-Agent 等常规请求信息。
- **删除数据**：直接删除数据目录即可清除全部本地数据（游戏、存档、账号、配置）。

## 5. 担保免责（GPLv3 §15）

本项目按「现状」提供，不附带任何明示或默示的担保，包括但不限于适销性、特定用途适用性、无权利瑕疵的担保。使用本项目及其下载内容的风险由使用者自行承担。

## 6. 责任限制（GPLv3 §16）

在适用法律允许的范围内，作者与贡献者不对因使用或无法使用本项目而产生的任何直接、间接、偶然、特殊或后果性损失承担责任，包括但不限于存档损坏、数据丢失、账号受限、设备损坏或第三方索赔。

## 7. 用户责任

使用者不得利用本项目从事下列行为，否则后果自负，与本项目作者无关：

- 侵犯他人知识产权，或分发盗版游戏与游戏资源
- 制作、传播外挂、作弊程序或破解工具
- 绕过正版授权、规避技术保护措施
- 违反当地法律法规或 Minecraft EULA

请自行备份存档与配置。启动器会按用户设置修改游戏目录内的文件（如 `options.txt`、模组启停），这类改动不构成对数据丢失的担保。

## 8. 第三方组件

| 组件 | 许可 |
| --- | --- |
| Azul Zulu JDK/JRE（按需下载，不分发） | GPL-2.0-with-classpath-exception |
| Oracle JDK/JRE（按需下载，不分发） | Oracle NFTC / OTN，非 GPL |
| Android JRE（Pojav 构建） | GPL-2.0-with-classpath-exception |
| LWJGL | BSD-3-Clause |
| MobileGlues | LGPL-2.1 |
| Electron / Node.js | MIT |
| 本项目自身 | GPL-3.0-or-later |

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 9. 二次分发要求

本项目以 GPL-3.0-or-later 授权。依据 GPLv3 第 7(b) 条，允许附加下列归属条款；任何二次分发（包括修改后分发、打包进其他产品、上架应用商店）必须：

1. 保留本项目的版权声明与 `LICENSE`、`NOTICE.md`
2. 在发行页面、关于页或安装包可见位置标注来源：
   - 项目名：TRCL（Tiny Runtime Craft Launcher）
   - 源码地址：https://github.com/yyl070405/TRCL
   - 原作者：yyl070405
3. 若修改过代码，明确说明修改内容与日期，不得暗示原项目认可该修改
4. 按 GPLv3 提供完整对应源码（含你的修改）

以上不构成对 GPLv3 的额外限制，只是第 7(b) 条允许的归属要求；除此之外，接收者仍享有 GPLv3 的全部权利。

**关于收费**：GPLv3 允许对分发收费，本项目不额外禁止。但收费分发同样要遵守上列要求，且不得附加「禁止再分发」「禁止修改」等 GPLv3 不允许的限制。

## 10. 解释权

本项目自身的文档（`README.md`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、`docs/`）及其中的归属与二次分发条款，**解释权归 TRCL 项目（版权持有人 yyl070405）所有**。对上述条款如何理解、如何适用有疑问时，以项目方的解释为准。

需要说明的两点：

1. 该解释权只针对本项目自己的文档与附加归属条款，**不涉及 GPL-3.0-or-later 正文**。许可证条文由自由软件基金会发布，其含义不受本项目声明影响，涉及许可证本身的争议由有管辖权的法院判断。
2. 本条款不减少、不改变接收者依 GPLv3 获得的任何权利。若本声明与 GPLv3 冲突，以 GPLv3 为准，该冲突条款视为可分离而其余部分继续有效。

## 11. 条款更新与可分离性

- 本声明可随项目更新。某一分发物适用的版本，以该分发物中随附的 `NOTICE.md` 为准；源码仓库中的版本对应当前 `main` 分支。
- 本声明任一条款被认定为无效或不可执行，不影响其余条款的效力。
- 本声明以中文撰写；如提供其他语言的译文，仅供阅读参考，以中文版本为准。

## 12. 联系与举报

- 问题反馈、侵权举报、许可疑问：https://github.com/yyl070405/TRCL/issues
- 发现有人违反第 9 条（去除来源标注再分发）时，请附上链接在上述地址提出。

## 13. FCL（Fold Craft Launcher）

本项目**不包含** FCL 的代码、资源或运行时，也不依赖 FCL 启动。

如果未来任何文件参考或引入了 FCL 的代码，必须同时满足：

1. 在该文件头部和提交说明中标注来源：项目名、原仓库地址、作者
2. 在 README / NOTICE 中致谢原作者
3. 整体继续遵循 **GPL-3.0-or-later**，分发二进制时提供完整对应源码
4. 保留原作者的版权声明，不附加额外限制

GPLv3 具有传染性：一旦引入 FCL 代码，整个分发物都按 GPLv3 处理。
