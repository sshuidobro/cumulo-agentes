#!/usr/bin/env bash
# Lanza al equipo de agentes sin supervisión hasta terminar todas las fichas.
# Uso: scripts/equipo.sh "objetivo"     (p. ej. "Lector PDF: iteración 3")
# Trabaja por rondas: cada ronda es una sesión nueva de `claude -p` con el
# contexto limpio (ver «Modo ronda» en la skill dirigir-equipo), así la
# conversación del coordinador no crece durante horas ni se vuelve a pagar
# entera en cada mensaje. El estado vive en las fichas de boveda/.
# El registro de cada ronda queda en registros/AAAA-MM-DD_HHMM-rN.jsonl
# Variables: EQUIPO_MODELO (por defecto sonnet), EQUIPO_MAX_RONDAS (100).
set -euo pipefail
cd "$(dirname "$0")/.."
objetivo="${1:?Indica el objetivo entre comillas}"
modelo="${EQUIPO_MODELO:-sonnet}"
max_rondas="${EQUIPO_MAX_RONDAS:-100}"
mkdir -p registros/contexto
inicio="$(date +%Y-%m-%d_%H%M)"

# Fichas que aún tienen trabajo (el coordinador decide cuáles son accionables).
estado() {
  grep -h '^estado:' boveda/Apps/*/Tareas/*.md 2>/dev/null \
    | grep -cE 'pendiente|en-curso|cambios-pedidos|en-revision|en-test' || true
}
huella() { grep -H '^estado:\|^intentos:' boveda/Apps/*/Tareas/*.md 2>/dev/null | md5sum; }

sin_avance=0
for ((r = 1; r <= max_rondas; r++)); do
  quedan="$(estado)"
  if [[ "$quedan" -eq 0 ]]; then
    echo "No quedan fichas abiertas."
    break
  fi
  antes="$(huella)"
  log="registros/${inicio}-r${r}.jsonl"
  echo "Ronda $r · fichas abiertas: $quedan · registro: $log"
  CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 claude -p "/dirigir-equipo $objetivo --ronda" \
    --model "$modelo" \
    --allowedTools "Bash,Edit,Write,Read,Glob,Grep,Agent,Skill,WebSearch,WebFetch" \
    --output-format stream-json --verbose > "$log" || echo "La ronda $r terminó con error; sigo."
  # Dos rondas seguidas sin ningún cambio de estado = solo quedan fichas
  # bloqueadas o hay un fallo que una ronda nueva no arregla: se para.
  if [[ "$(huella)" == "$antes" ]]; then
    sin_avance=$((sin_avance + 1))
    if [[ "$sin_avance" -ge 2 ]]; then
      echo "Dos rondas sin avances: revisa la bitácora (fichas bloqueadas o fallo repetido)."
      break
    fi
  else
    sin_avance=0
  fi
done
echo "Terminado. Registros: registros/${inicio}-r*.jsonl"
