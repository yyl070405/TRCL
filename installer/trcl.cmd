@echo off
rem TRCL 命令行入口：用 Electron 自带的 Node 跑 src/cli.js，不需要单独装 Node。
setlocal
set "ELECTRON_RUN_AS_NODE=1"
set "APP_DIR=%~dp0resources\app"
"%~dp0TRCL.exe" "%APP_DIR%\src\cli.js" %*
endlocal
