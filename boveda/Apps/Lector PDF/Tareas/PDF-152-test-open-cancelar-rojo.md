---
tipo: tarea
id: PDF-152
titulo: Arreglar el test rojo «Cancelar aborta la carga» de open.test.tsx
app: pdf
estado: pendiente
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
