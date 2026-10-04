; LawhatAlMahal.exe — what the shortcuts run. No window of its own: it runs
; launch.ps1 hidden (start the helper if needed, open the app window).
Unicode true
SilentInstall silent
RequestExecutionLevel user
Name "لوحة المحل"
OutFile "${OUTDIR}\LawhatAlMahal.exe"
Icon "${OUTDIR}\app-nsis.ico"
VIProductVersion "${VERSION}.0"
VIAddVersionKey "ProductName" "لوحة المحل"
VIAddVersionKey "FileDescription" "لوحة المحل"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "LegalCopyright" " "

Section
  nsExec::Exec '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$EXEDIR\launch.ps1"'
  Pop $0
SectionEnd
