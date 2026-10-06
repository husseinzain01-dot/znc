; Fr3oon.exe — what the shortcuts run. No window of its own: it runs
; launch.ps1 hidden (start the helper if needed, open the program's window).
Unicode true
SilentInstall silent
RequestExecutionLevel user
Name "Fr3oon"
OutFile "${OUTDIR}\Fr3oon.exe"
Icon "${OUTDIR}\app-nsis.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Fr3oon"
VIAddVersionKey "FileDescription" "Fr3oon"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" "Fr3oon"

!include "FileFunc.nsh"

; "Fr3oon.exe -Restart" (the «إعادة تشغيل Fr3oon» shortcut) passes it on.
Section
  ${GetParameters} $R0
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$EXEDIR\launch.ps1" $R0'
  Pop $0
SectionEnd
