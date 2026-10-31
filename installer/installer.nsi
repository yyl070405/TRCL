; TRCL Windows 安装器（NSIS 3）
; 用法：makensis installer/installer.nsi（需先 npm run dist 或 electron-builder --win dir）
Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.1.0"
!endif
!ifndef SRCDIR
  !define SRCDIR "dist/win-unpacked"
!endif

Name "TRCL"
!ifndef OUTFILE
  !define OUTFILE "TRCL-${VERSION}-win-x64-setup.exe"
!endif
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\TRCL"
InstallDirRegKey HKCU "Software\TRCL" "InstallDir"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "TRCL · Tiny Runtime Craft Launcher"

; 页面顺序：欢迎 → 使用须知（必须接受）→ 选安装目录 → 安装 → 完成
!define MUI_WELCOMEPAGE_TITLE "安装 TRCL"
!define MUI_WELCOMEPAGE_TEXT "这是一个第三方的 Minecraft: Java 版启动器，非官方。$\r$\n$\r$\n下一步先看使用须知，同意后再选择安装位置。"
!define MUI_LICENSEPAGE_TEXT_TOP "安装前请阅读下面的使用须知，同意后继续。"
!define MUI_LICENSEPAGE_TEXT_BOTTOM "接受本须知代表你同意 GNU GPL v3.0 条款与上面的说明。"
!define MUI_DIRECTORYPAGE_TEXT_TOP "选择安装位置。游戏、存档、日志都会放在该目录下的 data 文件夹。"
!define MUI_FINISHPAGE_RUN "$INSTDIR\TRCL.exe"
!define MUI_FINISHPAGE_RUN_TEXT "立即启动 TRCL"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "/root/workspace/mc-launcher/installer/NOTICE.rtf"
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "SimpChinese"
!insertmacro MUI_LANGUAGE "English"

Section "TRCL" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File /r "${SRCDIR}/*"

  CreateDirectory "$SMPROGRAMS\TRCL"
  CreateShortCut "$SMPROGRAMS\TRCL\TRCL.lnk" "$INSTDIR\TRCL.exe"
  CreateShortCut "$SMPROGRAMS\TRCL\卸载 TRCL.lnk" "$INSTDIR\Uninstall.exe"
  CreateShortCut "$DESKTOP\TRCL.lnk" "$INSTDIR\TRCL.exe"

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKCU "Software\TRCL" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "DisplayName" "TRCL"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "Publisher" "yyl070405"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "DisplayIcon" "$INSTDIR\TRCL.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "UninstallString" "$INSTDIR\Uninstall.exe"
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL" "NoRepair" 1
SectionEnd

Section "Uninstall"
  ; 只删程序文件，data 目录（存档、实例）保留
  RMDir /r "$INSTDIR\resources"
  RMDir /r "$INSTDIR\locales"
  Delete "$INSTDIR\*.dll"
  Delete "$INSTDIR\*.pak"
  Delete "$INSTDIR\*.bin"
  Delete "$INSTDIR\*.dat"
  Delete "$INSTDIR\*.exe"
  Delete "$INSTDIR\*.html"
  Delete "$INSTDIR\*.json"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\NOTICE.md"
  Delete "$INSTDIR\THIRD_PARTY_NOTICES.md"
  RMDir "$INSTDIR"

  Delete "$DESKTOP\TRCL.lnk"
  RMDir /r "$SMPROGRAMS\TRCL"
  DeleteRegKey HKCU "Software\TRCL"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\TRCL"
SectionEnd
