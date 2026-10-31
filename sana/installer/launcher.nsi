; Sana.exe — what the shortcuts run. No window of its own: it runs
; launch.ps1 hidden (start the helper, open Sana's window).
Unicode true
SilentInstall silent
RequestExecutionLevel user
Name "Sana"
OutFile "${OUTDIR}\Sana.exe"
Icon "${OUTDIR}\app-nsis.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "Sana"
VIAddVersionKey "FileDescription" "سنا"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"

Section
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$EXEDIR\launch.ps1"'
  Pop $0
SectionEnd
