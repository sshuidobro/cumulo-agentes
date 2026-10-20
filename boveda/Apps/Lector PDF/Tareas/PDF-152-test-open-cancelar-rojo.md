---
tipo: tarea
id: PDF-152
titulo: Arreglar el test rojo «Cancelar aborta la carga» de open.test.tsx
app: pdf
estado: en-test
depende_de: []
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, test, bug]
---

# PDF-152 · Arreglar el test rojo «Cancelar aborta la carga»

Plan: [[Apps/Lector PDF/Plan|Plan]] · Origen: commit b0ec064 (PDF-148); detectado en [[PDF-132-proteger-interfaz]]

## Objetivo
`apps/lector-pdf/tests/ui/open.test.tsx` («Cancelar aborta la carga…») falla en HEAD y deja `pnpm coverage` con código 1. Averigua si el fallo es de producción o del test y corrígelo **sin desactivar ni relajar el test** (si la expectativa es incorrecta tras PDF-148, ajústala con justificación en el Registro).

## Criterios de aceptación
- [ ] `pnpm coverage` en `apps/lector-pdf` sale con código 0.
- [ ] Lint y typecheck en verde.

## Registro

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/tests/ui/open.test.tsx` (solo el helper `holdLoad`); esta ficha.
- Qué he hecho: el fallo es del test, no de producción. Desde PDF-148 el sondeo de contraseña (`needsUserPassword`, ADR-0043) es asíncrono y ocurre antes de llamar al motor. Si se pulsa Cancelar durante ese sondeo, `loadPdf` recibe la señal ya abortada; el fake solo escuchaba el evento `abort`, así que nunca resolvía y la apertura quedaba en `loading`. El motor real (`engine/load.ts:72`) sí devuelve `cancelled` si la señal ya está abortada. He hecho que el fake haga lo mismo. La expectativa del test no cambia.
- Comandos ejecutados y resultado: `pnpm vitest run tests/ui/open.test.tsx` → 10/10 OK. `pnpm lint` → OK. `pnpm typecheck` → OK. `pnpm coverage` (raíz; en `apps/lector-pdf` no existe el script) → código 0, 311 ficheros y 4036 tests OK.
- Dudas o cosas que no he podido hacer: ninguna. Quedan sin tocar cambios de otros agentes (`tests/ui/export-dialog.test.tsx` modificado, dist-*). Producción no se ha cambiado.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
Sin problemas. El commit a6e5842 solo toca el helper `holdLoad` (una línea: si la señal ya está abortada, resuelve `cancelled`, igual que `engine/load.ts:72`). Las expectativas del test no cambian, no hay skip ni `.only`. `open.test.tsx` pasa 10/10.
