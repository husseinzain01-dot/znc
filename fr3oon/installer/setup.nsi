; Setup for لوحة المحل. Installs for the current user (no admin rights):
; program files, desktop and Start-menu shortcuts, an uninstaller and an
; entry in Apps & features. Settings (data file path, shop name, managers)
; live in %APPDATA%\LawhatAlMahal and survive updates and reinstalls.
Unicode true
!include "MUI2.nsh"

Name "لوحة المحل"
OutFile "${OUTDIR}\LawhatAlMahal-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\LawhatAlMahal"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "لوحة المحل ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "لوحة المحل"
VIAddVersionKey "FileDescription" "تنصيب لوحة المحل"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" " "

!define MUI_ICON "${OUTDIR}\app-nsis.ico"
!define MUI_UNICON "${OUTDIR}\app-nsis.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "تنصيب لوحة المحل"
!define MUI_WELCOMEPAGE_TEXT "لوحة المحل تشتغل على نفس بيانات حساباتي: بيع وشراء ووصولات وتقارير.$\r$\n$\r$\nالتنصيب ما يحتاج صلاحية مدير، وما يغيّر أي شي بملف البيانات.$\r$\n$\r$\nدوس التالي حتى تكمل."
!define MUI_FINISHPAGE_RUN "$INSTDIR\LawhatAlMahal.exe"
!define MUI_FINISHPAGE_RUN_TEXT "افتح لوحة المحل هسه"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\LawhatAlMahal"
!define STOPHELPER `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -Command "try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{'X-Lawha'='1'} -Uri 'http://localhost:8765/api/shutdown' -TimeoutSec 3 | Out-Null } catch { }"`

Section "install"
  ; an older version may be running: stop its helper so files can be replaced
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 1500

  SetOutPath "$INSTDIR"
  File "${OUTDIR}\LawhatAlMahal.exe"
  File "${OUTDIR}\launch.ps1"
  File "${OUTDIR}\server.ps1"
  File "${OUTDIR}\lawha.html"
  File "${OUTDIR}\app.ico"
  File "${OUTDIR}\README-AR.txt"

  CreateShortcut "$DESKTOP\لوحة المحل.lnk" "$INSTDIR\LawhatAlMahal.exe" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\لوحة المحل"
  CreateShortcut "$SMPROGRAMS\لوحة المحل\لوحة المحل.lnk" "$INSTDIR\LawhatAlMahal.exe" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\لوحة المحل\إزالة لوحة المحل.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "لوحة المحل"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "لوحة المحل"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 1200
SectionEnd

Section "Uninstall"
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 1500
  Delete "$DESKTOP\لوحة المحل.lnk"
  Delete "$SMPROGRAMS\لوحة المحل\لوحة المحل.lnk"
  Delete "$SMPROGRAMS\لوحة المحل\إزالة لوحة المحل.lnk"
  RMDir "$SMPROGRAMS\لوحة المحل"
  Delete "$INSTDIR\LawhatAlMahal.exe"
  Delete "$INSTDIR\launch.ps1"
  Delete "$INSTDIR\server.ps1"
  Delete "$INSTDIR\lawha.html"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\README-AR.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; %APPDATA%\LawhatAlMahal (settings, log) is kept for a later reinstall.
SectionEnd
