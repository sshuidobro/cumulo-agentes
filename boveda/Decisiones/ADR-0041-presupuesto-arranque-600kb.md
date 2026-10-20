---
tipo: decision
id: ADR-0041
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, rendimiento, bundle]
---

# ADR-0041 · El presupuesto de JavaScript de arranque sube a 600 000 bytes

Relacionadas: [[ADR-0017-carga-diferida-de-pdfjs]] · [[ADR-0027-dialogos-diferidos]] · [[PDF-140-presupuesto-de-arranque]]

## Contexto
Con las iteraciones 3 y 4 el arranque llegó a 541 666 bytes y `bundle:check` (máximo 500 000) dejó el build en rojo, bloqueando la PR #5 a `main`. Sergio preguntó por qué 500 KB si la app ya funciona: la diferencia (~42 KB) apenas se nota (centésimas de segundo; casi nada en escritorio, que lee del disco).

## Decisión
Decisión de producto del usuario (opción A, 2026-10-19): el presupuesto pasa a **600 000 bytes** (`ENTRY_JS_BUDGET_BYTES` en `apps/lector-pdf/tests/bundle/bundle-budget.ts`). Se mantiene el tope para que el arranque no crezca sin control. [[PDF-140-presupuesto-de-arranque]] sigue pendiente como optimización (diferir lo que no hace falta para la primera página) pero ya no bloquea.

## Consecuencias
- El build vuelve a pasar con margen de ~58 KB.
- Cada ficha nueva sigue sin poder pasar de 600 000 bytes; por encima, se difiere código o se vuelve a preguntar al usuario.
