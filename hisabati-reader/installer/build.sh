#!/usr/bin/env bash
# Builds the Windows installer: dist/LawhatAlMahal-Setup-<version>.exe
# Needs: node, npm deps, Playwright Chromium (for the icon), makensis (NSIS 3).
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$PWD/dist"
rm -rf "$OUT"
mkdir -p "$OUT"

node build.mjs
node installer/make-icon.mjs "$OUT"

# Windows PowerShell 5.1 and NSIS read Arabic correctly only from UTF-8 with
# a BOM; Windows tools also expect CRLF line ends.
python3 - "$OUT" <<'PY'
import sys, pathlib
out = pathlib.Path(sys.argv[1])
def win(src, dst):
    text = pathlib.Path(src).read_text(encoding='utf-8-sig').replace('\r\n', '\n')
    pathlib.Path(dst).write_text(text, encoding='utf-8-sig', newline='\r\n')
win('server/server.ps1', out / 'server.ps1')
win('installer/launch.ps1', out / 'launch.ps1')
win('installer/README-AR.txt', out / 'README-AR.txt')
win('installer/launcher.nsi', out / 'launcher.nsi')
win('installer/setup.nsi', out / 'setup.nsi')
PY
cp release/hisabati-reader.html "$OUT/lawha.html"

VERSION=$(grep -oP "^\\\$Version = '\\K[^']+" server/server.ps1)
makensis -V2 -DOUTDIR="$OUT" -DVERSION="$VERSION" "$OUT/launcher.nsi"
makensis -V2 -DOUTDIR="$OUT" -DVERSION="$VERSION" "$OUT/setup.nsi"
ls -la "$OUT"/*.exe
