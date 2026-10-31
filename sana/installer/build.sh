#!/usr/bin/env bash
# Builds the Windows installer: dist/Sana-Setup-<version>.exe
# Needs: node, npm deps, Playwright Chromium (for the icon), makensis (NSIS 3).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/dist"
rm -rf "$OUT"
mkdir -p "$OUT"
node build.mjs
node installer/make-icon.mjs "$OUT"
# Windows PowerShell 5.1 and NSIS read Arabic correctly only from UTF-8 with a BOM, CRLF
python3 - "$OUT" <<'PY'
import sys, pathlib
out = pathlib.Path(sys.argv[1])
def win(src, dst):
    text = pathlib.Path(src).read_text(encoding='utf-8-sig').replace('\r\n', '\n')
    pathlib.Path(dst).write_text(text, encoding='utf-8-sig', newline='\r\n')
for f in ['server.ps1', 'launch.ps1', 'README-AR.txt', 'launcher.nsi', 'setup.nsi']:
    win('installer/' + f, out / f)
PY
cp release/sana.html "$OUT/sana.html"
VERSION=$(node -p "require('./package.json').version")
makensis -V2 -DOUTDIR="$OUT" -DVERSION="$VERSION" "$OUT/launcher.nsi"
makensis -V2 -DOUTDIR="$OUT" -DVERSION="$VERSION" "$OUT/setup.nsi"
ls -la "$OUT"/*.exe
sha256sum "$OUT/Sana-Setup-$VERSION.exe"
