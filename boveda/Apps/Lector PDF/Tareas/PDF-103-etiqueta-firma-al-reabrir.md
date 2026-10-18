---
tipo: tarea
id: PDF-103
titulo: Etiqueta «Firma» en el panel al reabrir un PDF con firmas guardadas
app: pdf
estado: bloqueada
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: solo esta ficha (`estado: bloqueada`). No he tocado código.
- Qué he hecho: he leído la ficha, `to-pdf.ts` (`SIGNATURE_STAMP_NAME`), `import.ts` (`importForeign`) y `comment-list.ts` (`FOREIGN_LABELS`). Comprobado en el fuente de pdf.js instalado (`pdfjs-dist@6.4.299`, `build/pdf.worker.mjs`, `class StampAnnotation`): el constructor solo guarda `hasOwnCanvas`, `isEditable` y `noHTML`; no expone el `/Name` del `/Stamp`. El objeto que devuelve `page.getAnnotations()` para un `Stamp` no trae ese dato, así que `importForeign` no puede distinguir `/SuiteFirma` de otro sello con la API pública de pdf.js.
- Comandos ejecutados y resultado: ninguno de build/test (no había nada que compilar); solo lectura de código y del fuente de pdf.js.
- Dudas o cosas que no he podido hacer: falta decidir el mecanismo. Opciones: (a) leer el diccionario `/Stamp` del fichero con un parser propio en `core/` (nuevo código de E/S de PDF, fuera de lo previsto), (b) acceder a objetos internos de pdf.js (no es API pública, frágil), (c) marcar la firma con otro dato que pdf.js sí exponga (p. ej. `/Subj` o `/Contents`), lo que cambia el escritor de PDF-085 y el formato escrito. Pido decisión al líder sobre cuál usar; con ella lo implemento. No he hecho commit: no hay cambios de código.
