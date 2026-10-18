---
tipo: decision
id: ADR-0026
app: comun
estado: aceptada
fecha: 2026-10-18
creado: 2026-10-18
actualizado: 2026-10-18
tags: [decision, equipo, costes, agentes]
---

# ADR-0026 · Gastar menos tokens en el equipo de agentes sin perder calidad

## Contexto
El usuario pidió que el equipo avance más rápido y gaste menos tokens, sin perder calidad de código ni información. Medido el 18-10 en la sesión del coordinador:
- Lo que más gasta es la **lectura de caché**: unos 38 M de tokens leídos de caché en una sola conversación de Opus que duró horas. Cada mensaje reenvía la conversación entera, así que todo lo que el coordinador leía se volvía a pagar en cada turno. Fuente: [Costes de Claude Code](https://code.claude.com/docs/en/costs), apartado «Why usage climbs in a long session».
- El `Plan.md` del Lector PDF ocupa 34 KB y los agentes lo leían entero solo para ver los comandos.
- El código fuente ocupa unos 850 KB y se localizaba leyendo ficheros enteros.
- La «comprobación completa» ejecutaba la batería de tests dos veces (`pnpm test && pnpm coverage`), y la salida de vitest, con la tabla de cobertura, entraba entera en el contexto.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. Coordinador por rondas con contexto limpio, en Sonnet** | Quita la causa principal (la conversación crece durante horas); el estado ya vive en las fichas | La ronda tiene que dejarlo todo anotado (ya lo exige el flujo) | — |
| **B. Índice de código generado al momento (`scripts/indice-codigo.mjs`) y agente `explorador` en Haiku** | Ningún fichero se lee entero para localizar código; sin dependencias ni servicios externos; nunca está desactualizado ni da conflictos en los worktrees | Es un índice de símbolos exportados, no búsqueda semántica | Propio |
| C. Serena (MCP, servidores de lenguaje) | Navegación por símbolos con LSP; local | Exige `uv`, Python e instalar servidores de lenguaje en cada contenedor; más herramientas en el contexto | MIT |
| D. claude-context (Zilliz, MCP semántico) | Búsqueda semántica y menos tokens según su autor (−40 %) | Necesita una base de datos vectorial y un proveedor de *embeddings*, normalmente en la nube: el código saldría del ordenador | MIT |
| E. Todos los subagentes en Haiku | Lo más barato | Bajaría la calidad de la revisión y del test: descartado | — |

## Decisión
- **A + B**, más reglas de lectura económica en los agentes:
  - leer trozos (`Read` con `offset`/`limit`) en lugar de ficheros enteros;
  - del Plan, solo la sección `## Comandos`;
  - salida de comandos con `tail`, repitiendo con la salida completa solo lo que falle;
  - `pnpm coverage` sin un `pnpm test` delante, porque ya ejecuta todos los tests;
  - el revisor lee el diff fichero a fichero.
- No se cambia el modelo de quien escribe, revisa o prueba el código. La batería completa de tests se sigue ejecutando en cada ficha: lo que se resume es la salida, no las pruebas.
- **D** queda descartada por la norma «ningún dato sale del ordenador».
- **C** queda como mejora futura si el índice se queda corto.

## Consecuencias
- Lo que se gana:
  - Cada ronda de `scripts/equipo.sh` empieza con el contexto vacío.
  - El coordinador ya no relee el Plan ni la bitácora.
  - Los agentes localizan el código con el índice (todo el repositorio cabe en unos 27 KB, frente a 850 KB de código).
  - La batería de tests corre una vez en lugar de dos.
- Lo que hay que vigilar:
  - Una ronda que no anote su trabajo en la ficha lo perdería para la siguiente. El flujo ya obliga a escribir el Registro.
  - Si dos rondas seguidas no cambian ningún estado, el script se para y hay que mirar la bitácora.
  - Si un agente decide mal por haber leído solo un trozo, se vuelve a la lectura completa en ese caso, nunca a costa de la calidad.
