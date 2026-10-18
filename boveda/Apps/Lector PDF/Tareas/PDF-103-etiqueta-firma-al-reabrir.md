---
tipo: tarea
id: PDF-103
titulo: Etiqueta «Firma» en el panel al reabrir un PDF con firmas guardadas
app: pdf
estado: pendiente
depende_de: [PDF-085]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, anotaciones, core]
---

# PDF-103 · Etiqueta «Firma» en el panel al reabrir

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0020-firma-visual]] · Origen: duda 1 de [[PDF-085-anotacion-de-firma]]

## Objetivo
Al reabrir un PDF guardado con firmas de la suite, el panel de comentarios las muestra como «Firma» y no como «Sello». Siguen siendo anotaciones ajenas de solo lectura (ADR-0020); solo cambia la etiqueta.

## Contexto
- `SIGNATURE_STAMP_NAME` (`src/core/annotations/to-pdf.ts`) es el `/Name` que escribe PDF-085.
- Leer: `src/core/annotations/import.ts` (`importForeign`), `comment-list.ts` (`FOREIGN_LABELS`), `src/ui/messages.ts`.

## Criterios de aceptación
- [ ] Un `/Stamp` con `/Name /SuiteFirma` se lista como «Firma»; un `/Stamp` con otro nombre o sin él sigue como «Sello».
- [ ] Sigue siendo ajeno: no editable ni movible.
- [ ] Test de ida y vuelta: escribir una firma (PDF-085), reabrir con pdf.js y comprobar la etiqueta del panel.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Hacer editables las firmas guardadas.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
