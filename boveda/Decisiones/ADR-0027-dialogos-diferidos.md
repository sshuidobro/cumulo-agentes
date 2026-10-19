---
tipo: decision
id: ADR-0027
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, rendimiento, bundle]
---

# ADR-0027 · Los diálogos «Crear firma», «Propiedades» e «Imprimir» se cargan bajo demanda

## Contexto
Con la iteración 3 el JavaScript de arranque llegó a 500 004 bytes (`index-*.js` 496 646 + chunks estáticos), 4 bytes por encima del presupuesto del Plan (500 000, [[ADR-0017-carga-diferida-de-pdfjs]]). Detectado en [[PDF-090-e2e-iteracion-3]]. Los tres diálogos nuevos (~30 KB de fuente en `ui/signature`, `ui/properties`, `ui/print`) van en el arranque aunque casi nunca se abren al empezar.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| Subir el presupuesto a 520 000 | Trivial | Relaja un presupuesto sin causa; el siguiente cambio vuelve a rozarlo | — |
| Recortar bytes sueltos (mensajes, código muerto) | Sin cambios de carga | Margen de pocos bytes; no escala | — |
| **`React.lazy` + `Suspense` para los tres diálogos, montados solo cuando están abiertos** | Saca código que no hace falta al arrancar; margen real; patrón ya usado con pdf.js | Primer clic carga un chunk local (< 50 ms, sin red); los tests de componente deben esperar con `findBy*` | MIT (React, ya en uso) |

## Decisión
Los tres diálogos se importan con `React.lazy` y se montan solo con su estado `open` a `true`, dentro de `<Suspense fallback={null}>`. El presupuesto **no cambia** (≤ 500 000 bytes); objetivo tras el cambio ≤ 485 000 bytes. Ficha: [[PDF-090-e2e-iteracion-3]] (ronda 2).

## Consecuencias
- Margen de ~15 KB para la iteración 4.
- Todo diálogo nuevo que no se use al arrancar se carga igual (regla para próximas fichas).
- Vigilar que el foco inicial y `aria-*` de los diálogos siguen igual (lo cubren `iteration3-a11y` y los tests de componente).

## Revisión 2026-10-19 (tras [[PDF-090-e2e-iteracion-3]], ronda 2)
- Medido: arranque **486 857 bytes** (antes 500 004). El objetivo de 485 000 era un margen interno de la replanificación, no el presupuesto: el presupuesto de `bundle:check` sigue en **500 000** y se cumple. Se acepta; margen real ~13 KB.
- No se sube el presupuesto. A vigilar en la iteración 4: el trozo estático `PrintDialog.module` (62 534 bytes) existe porque `PrintProgress.tsx` importa `PrintDialog.module.css`; la primera ficha de la iteración 4 que toque el arranque lo separará (CSS propio de `PrintProgress`) y medirá.
