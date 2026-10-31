; Setup for Sana, for the current user (no admin rights): the program, a
; desktop and Start-menu shortcut, an uninstaller and an entry in Apps.
Unicode true
!include "MUI2.nsh"

Name "سنا"
OutFile "${OUTDIR}\Sana-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Sana"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Sana ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Sana"
VIAddVersionKey "FileDescription" "تثبيت سنا"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

!define MUI_ICON "${OUTDIR}\app-nsis.ico"
!define MUI_UNICON "${OUTDIR}\app-nsis.ico"
!define MUI_WELCOMEPAGE_TITLE "تثبيت سنا ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "سنا مساعدة صوتية تحچي عراقي، بشكل ضوئي على الشاشة.$\r$\n$\r$\nتشتغل على متصفح Microsoft Edge وتحتاج إنترنت للسماع، وميكروفون.$\r$\n$\r$\nاضغط «التالي» للمتابعة."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Sana.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل سنا الآن"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Sana"
!define STOPHELPER `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "[Net.WebRequest]::DefaultWebProxy = $$null; try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{'X-Sana'='1'} -Uri 'http://localhost:8780/api/shutdown' -TimeoutSec 3 | Out-Null } catch { }"`

Section "install"
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 1000
  SetOutPath "$INSTDIR"
  File "${OUTDIR}\Sana.exe"
  File "${OUTDIR}\launch.ps1"
  File "${OUTDIR}\server.ps1"
  File "${OUTDIR}\sana.html"
  File "${OUTDIR}\app.ico"
  File "${OUTDIR}\README-AR.txt"
  CreateShortcut "$DESKTOP\سنا.lnk" "$INSTDIR\Sana.exe" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\Sana"
  CreateShortcut "$SMPROGRAMS\Sana\سنا.lnk" "$INSTDIR\Sana.exe" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\Sana\إزالة سنا.lnk" "$INSTDIR\uninstall.exe"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "سنا (Sana)"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 1000
  Delete "$DESKTOP\سنا.lnk"
  Delete "$SMPROGRAMS\Sana\سنا.lnk"
  Delete "$SMPROGRAMS\Sana\إزالة سنا.lnk"
  RMDir "$SMPROGRAMS\Sana"
  Delete "$INSTDIR\Sana.exe"
  Delete "$INSTDIR\launch.ps1"
  Delete "$INSTDIR\server.ps1"
  Delete "$INSTDIR\sana.html"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\README-AR.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
SectionEnd
