; Setup for Fr3oon. Installs for the current user (no admin rights):
; program files, desktop and Start-menu shortcuts, an uninstaller and an
; entry in Apps & features. This computer's settings and the license live in
; %APPDATA%\Fr3oon; the database (C:\Fr3oon\Data by default) and its backups
; are never touched by installing, updating or removing the program.
; Online updates run it as: Fr3oon-Setup-x.y.z.exe /S /RELAUNCH
Unicode true
!include "MUI2.nsh"
!include "FileFunc.nsh"

Name "Fr3oon"
OutFile "${OUTDIR}\Fr3oon-Setup-${VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\Fr3oon"
RequestExecutionLevel user
SetCompressor /SOLID lzma
BrandingText "Fr3oon ${VERSION}"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Fr3oon"
VIAddVersionKey "FileDescription" "تثبيت Fr3oon"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Fr3oon"

!define MUI_ICON "${OUTDIR}\app-nsis.ico"
!define MUI_UNICON "${OUTDIR}\app-nsis.ico"
!define MUI_ABORTWARNING
!define MUI_WELCOMEPAGE_TITLE "تثبيت Fr3oon ${VERSION}"
!define MUI_WELCOMEPAGE_TEXT "Fr3oon نظام لإدارة المبيعات والمشتريات والمخزون والحسابات.$\r$\n$\r$\nلا يحتاج التثبيت إلى صلاحيات مدير النظام. إذا كان البرنامج مثبّتاً من قبل، فسيُحدَّث وتبقى البيانات والإعدادات كما هي.$\r$\n$\r$\nاضغط «التالي» للمتابعة."
!define MUI_FINISHPAGE_RUN "$INSTDIR\Fr3oon.exe"
!define MUI_FINISHPAGE_RUN_TEXT "تشغيل Fr3oon الآن"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "Arabic"

!define UNINSTKEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Fr3oon"
!define PS `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass`
!define STOPHELPER `${PS} -Command "[Net.WebRequest]::DefaultWebProxy = $$null; try { Invoke-WebRequest -UseBasicParsing -Method POST -Headers @{'X-Lawha'='1'} -Uri 'http://localhost:8770/api/shutdown' -TimeoutSec 3 | Out-Null } catch { }"`

Section "install"
  ; a running copy (or the one that started this update) must stop first so
  ; its files can be replaced
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 2000
  ; one that did not answer: by the process it noted
  nsExec::Exec `${PS} -Command "try { $$p = [int](Get-Content -LiteralPath (Join-Path $$env:APPDATA 'Fr3oon\helper.pid') -ErrorAction Stop | Select-Object -First 1); Stop-Process -Id $$p -Force -ErrorAction Stop } catch { }"`
  Pop $0

  SetOutPath "$INSTDIR"
  File "${OUTDIR}\Fr3oon.exe"
  File "${OUTDIR}\launch.ps1"
  File "${OUTDIR}\server.ps1"
  File "${OUTDIR}\fr3oon.html"
  File "${OUTDIR}\app.ico"
  File "${OUTDIR}\README-AR.txt"

  CreateShortcut "$DESKTOP\Fr3oon.lnk" "$INSTDIR\Fr3oon.exe" "" "$INSTDIR\app.ico" 0
  CreateDirectory "$SMPROGRAMS\Fr3oon"
  CreateShortcut "$SMPROGRAMS\Fr3oon\Fr3oon.lnk" "$INSTDIR\Fr3oon.exe" "" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\Fr3oon\إعادة تشغيل Fr3oon.lnk" "$INSTDIR\Fr3oon.exe" "-Restart" "$INSTDIR\app.ico" 0
  CreateShortcut "$SMPROGRAMS\Fr3oon\إزالة Fr3oon.lnk" "$INSTDIR\uninstall.exe"

  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayName" "Fr3oon"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTKEY}" "Publisher" "Fr3oon"
  WriteRegStr HKCU "${UNINSTKEY}" "DisplayIcon" "$INSTDIR\app.ico"
  WriteRegStr HKCU "${UNINSTKEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTKEY}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "NoRepair" 1
  WriteRegDWORD HKCU "${UNINSTKEY}" "EstimatedSize" 1200

  ; an online update: start the program again without a new window (the
  ; open one reloads itself once the new version answers)
  ${GetParameters} $R0
  ClearErrors
  ${GetOptions} $R0 "/RELAUNCH" $R1
  IfErrors done
    nsExec::Exec `${PS} -WindowStyle Hidden -File "$INSTDIR\launch.ps1" -NoWindow`
    Pop $0
  done:
SectionEnd

Section "Uninstall"
  nsExec::Exec ${STOPHELPER}
  Pop $0
  Sleep 1500
  Delete "$DESKTOP\Fr3oon.lnk"
  Delete "$SMPROGRAMS\Fr3oon\Fr3oon.lnk"
  Delete "$SMPROGRAMS\Fr3oon\إعادة تشغيل Fr3oon.lnk"
  Delete "$SMPROGRAMS\Fr3oon\إزالة Fr3oon.lnk"
  RMDir "$SMPROGRAMS\Fr3oon"
  Delete "$INSTDIR\Fr3oon.exe"
  Delete "$INSTDIR\launch.ps1"
  Delete "$INSTDIR\server.ps1"
  Delete "$INSTDIR\fr3oon.html"
  Delete "$INSTDIR\app.ico"
  Delete "$INSTDIR\README-AR.txt"
  Delete "$INSTDIR\uninstall.exe"
  RMDir "$INSTDIR"
  DeleteRegKey HKCU "${UNINSTKEY}"
  ; Kept for a later reinstall: %APPDATA%\Fr3oon (settings, license, logs),
  ; and the database and backups wherever they were chosen.
SectionEnd
