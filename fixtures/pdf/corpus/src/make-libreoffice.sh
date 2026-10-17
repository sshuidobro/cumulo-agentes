#!/usr/bin/env bash
# Regenera fixtures/pdf/corpus/libreoffice/*.pdf a partir de los HTML de esta carpeta (LibreOffice headless).
set -euo pipefail
cd "$(dirname "$0")"
node make-largo.mjs
mkdir -p ../libreoffice
for html in *.html; do
  soffice --headless --infilter="HTML (StarWriter)" \
    --convert-to 'pdf:writer_pdf_Export:{"ExportBookmarks":{"type":"boolean","value":"true"}}' \
    --outdir ../libreoffice "$html"
done
