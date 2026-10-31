# Windows 安装器

`installer.nsi` 是一个独立的最小安装脚本，不依赖 electron-builder，用系统 NSIS 直接出 `.exe`。

流程：欢迎 → **使用须知（必须点「我接受」）** → 选择安装目录 → 复制文件 → 完成（可直接启动）。

```bash
# 1. 先准备解包后的程序目录
npx electron-builder --win dir --x64 --publish never
# 2. 编译安装器（Linux 上需要 apt install nsis；Windows 装 NSIS 3）
makensis -DVERSION=0.1.0 \
  -DSRCDIR="$PWD/dist/win-unpacked" \
  -DOUTFILE="$PWD/dist/TRCL-0.1.0-win-x64-setup.exe" \
  installer/installer.nsi
```

- 默认装到 `%LOCALAPPDATA%\Programs\TRCL`，普通用户权限，不要管理员
- 注册表只写 `HKCU\Software\TRCL` 与卸载项，不写系统级位置
- 卸载只删程序文件，`data` 目录（存档、实例、下载）保留
- 使用须知文本在 `NOTICE.txt`，`NOTICE.rtf` 是给 NSIS 许可页用的转换结果（改文本后要重新生成）
