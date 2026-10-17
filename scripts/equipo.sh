#!/usr/bin/env bash
# Lanza al equipo de agentes sin supervisión hasta terminar todas las fichas.
# Uso: scripts/equipo.sh "objetivo"     (p. ej. "Lector PDF: primera iteración")
# El registro completo queda en registros/AAAA-MM-DD_HHMM.jsonl
set -euo pipefail
cd "$(dirname "$0")/.."
objetivo="${1:?Indica el objetivo entre comillas}"
mkdir -p registros
log="registros/$(date +%Y-%m-%d_%H%M).jsonl"
CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p "/dirigir-equipo $objetivo" \
  --allowedTools "Bash,Edit,Write,Read,Glob,Grep,Agent,Skill,WebSearch,WebFetch" \
  --output-format stream-json --verbose > "$log"
echo "Terminado. Registro: $log"
