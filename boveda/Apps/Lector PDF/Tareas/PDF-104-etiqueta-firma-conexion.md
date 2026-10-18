---
tipo: tarea
id: PDF-104
titulo: Etiqueta «Firma» al reabrir - conexión con la sesión de anotaciones
app: pdf
estado: pendiente
depende_de: [PDF-103]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, firma, anotaciones, state]
---

# PDF-104 · Etiqueta «Firma» al reabrir (conexión)

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0020-firma-visual]] · Viene de [[PDF-103-etiqueta-firma-al-reabrir]]

## Objetivo
Al abrir un PDF guardado con firmas de la suite, el panel de comentarios las lista como «Firma» (no «Sello»), tanto en el escaneo completo como en documentos grandes importados por página («lazy»). Siguen siendo ajenas y de solo lectura.

## Contexto
- `src/core/annotations/stamp-names.ts` (PDF-103): `readStampNames`, `withStampNames`.
- `src/engine/annotations-import.ts` (entero, 40 líneas).
- `src/state/annotation-actions.ts` → `Session` (l. 78-85), `startAnnotationSession` (l. 156-196), `readLazyPage` (l. 243-254).
- `src/state/document-actions.ts:165` (llamada a `startAnnotationSession`; `file.source` está disponible).
- `src/core/pdf/incremental.ts` → `openForSave` (l. 110).

## Qué hacer
1. `engine/annotations-import.ts`:
   - `readPageAnnotations(page, fallbackDate, reader: ObjectReader | null = null)`: tras `importPageAnnotations`, si `reader !== null` y hay algún ajeno con `subtype === 'Stamp'`, devolver `withStampNames(imported, await readStampNames(reader, imported.foreign))`; si no, `imported` tal cual.
   - `scanAnnotations`: nueva opción `readonly reader?: ObjectReader | null`, que se pasa a `readPageAnnotations`.
2. `state/annotation-actions.ts`:
   - `Session` gana `readonly reader: Promise<ObjectReader | null>`.
   - `startAnnotationSession(pdf, signal, source?: ByteSource)`: `reader = source === undefined ? Promise.resolve(null) : openForSave(source).then((r) => (r.ok ? r.value : null), () => null)`. El estado inicial se pone igual que ahora (síncrono). El escaneo arranca con `current.reader.then((reader) => scanAnnotations(pdf.doc, { ...lo de ahora, reader }))` y conserva el mismo `.then/.catch` (si `openForSave` falla → `reader` `null` → etiquetas «Sello», sin error al usuario; `log.warn` ya existe en el `catch`).
   - `readLazyPage`: `readPageAnnotations(page, nowIso(), await current.reader)`.
3. `state/document-actions.ts:165`: `startAnnotationSession(loaded, scan.signal, file.source)`.

## Criterios de aceptación
- [ ] `tests/unit/annotations/engine-import.test.ts`: con `reader`, un PDF con firma de la suite da un ajeno con `stampName: 'SuiteFirma'`; sin `reader` (`null`), no hay `stampName`; una página sin `/Stamp` no llama a `getDict` (espía).
- [ ] Test de UI (Testing Library, en `tests/ui/comments-panel.test.tsx`): abrir con `openDocument` un PDF de una página con firma escrita por `buildIncrementalUpdate` → el panel muestra una fila «Firma» y el filtro de tipos ofrece «Firma»; el mismo PDF con un `/Stamp /Name /Approved` muestra «Sello».
- [ ] Lo mismo en modo «lazy» (documento con más de `SCAN_PAGE_LIMIT` páginas, o el helper `lazyLoaded()` de los tests con `source`): la fila de la página importada dice «Firma».
- [ ] La fila «Firma» reabierta sigue siendo de solo lectura: sin botón de borrar activo ni arrastre en la capa (mismo comportamiento que hoy para ajenos).
- [ ] Si `openForSave` devuelve error (fuente que falla al leer), el escaneo termina (`scan: 'done'`) y la fila dice «Sello»; sin mensajes nuevos al usuario.
- [ ] Rendimiento: `tests/perf/annotations-import.perf.test.ts` sigue dentro de su presupuesto (solo se lee un diccionario por `/Stamp`).
- [ ] Las llamadas existentes `startAnnotationSession(x, signal)` de los tests siguen compilando sin cambios.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` (en `apps/lector-pdf`) con código 0.

## Fuera de alcance
- Hacer editables las firmas guardadas.
- Reutilizar el `ObjectReader` de la sesión al guardar (guardar sigue abriendo el suyo).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
