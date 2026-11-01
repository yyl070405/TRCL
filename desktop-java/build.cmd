@echo off
rem 编译并运行 Java 版启动器（Windows，不需要 Node / npm）
setlocal
cd /d "%~dp0"
set "ROOT=.."
set "GSON=%ROOT%\android-app\libs\gson-2.11.0.jar"
if not exist "%GSON%" (
  echo 找不到 Gson: %GSON%
  exit /b 1
)
if exist build rmdir /s /q build
mkdir build
javac -encoding UTF-8 -cp "%GSON%" -d build ^
  %ROOT%\android-app\core\src\main\java\dev\mclauncher\core\*.java ^
  src\main\java\dev\trcl\desktop\*.java
if errorlevel 1 exit /b 1
echo 编译完成: desktop-java\build
if /i "%1"=="--build-only" exit /b 0
java -cp "build;%GSON%" dev.trcl.desktop.Main %*
