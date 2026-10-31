# 来源与许可声明

## FCL（Fold Craft Launcher）

本项目**不包含** FCL 的代码、资源或运行时，也不依赖 FCL 启动。

如果未来任何文件参考或引入了 FCL 的代码，必须同时满足：

1. 在该文件头部和提交说明中标注来源：项目名、原仓库地址、作者
2. 在 README / NOTICE 中致谢原作者
3. 整体继续遵循 **GPL-3.0-or-later**，分发二进制时提供完整对应源码
4. 保留原作者的版权声明，不附加额外限制

GPLv3 具有传染性：一旦引入 FCL 代码，整个分发物都按 GPLv3 处理。

## 其他组件

| 组件 | 许可 |
| --- | --- |
| Android JRE（Pojav 构建） | GPL-2.0-with-classpath-exception |
| LWJGL | BSD-3-Clause |
| MobileGlues | LGPL-2.1 |
| Electron / Node.js | MIT |
| 本项目自身 | GPL-3.0-or-later |

详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

## 二次分发要求

本项目以 GPL-3.0-or-later 授权。依据 GPLv3 第 7(b) 条，允许附加下列归属条款；任何二次分发（包括修改后分发、打包进其他产品、上架应用商店）必须：

1. 保留本项目的版权声明与 `LICENSE`、`NOTICE.md`
2. 在发行页面、关于页或安装包可见位置标注来源：
   - 项目名：TRCL（Tiny Runtime Craft Launcher）
   - 源码地址：https://github.com/yyl070405/TRCL
   - 原作者：yyl070405
3. 若修改过代码，明确说明修改内容与日期，不得暗示原项目认可该修改
4. 按 GPLv3 提供完整对应源码（含你的修改）

以上不构成对 GPLv3 的额外限制，只是第 7(b) 条允许的归属要求；除此之外，接收者仍享有 GPLv3 的全部权利。

## 解释权

本项目自身的文档（`README.md`、`NOTICE.md`、`THIRD_PARTY_NOTICES.md`、`docs/`）及其中的归属与二次分发条款，**解释权归 TRCL 项目（版权持有人 yyl070405）所有**。对上述条款如何理解、如何适用有疑问时，以项目方的解释为准。

需要说明的两点：

1. 该解释权只针对本项目自己的文档与附加归属条款，**不涉及 GPL-3.0-or-later 正文**。许可证条文由自由软件基金会发布，其含义不受本项目声明影响，涉及许可证本身的争议由有管辖权的法院判断。
2. 本条款不减少、不改变接收者依 GPLv3 获得的任何权利。若本声明与 GPLv3 冲突，以 GPLv3 为准，该冲突条款视为可分离而其余部分继续有效。
