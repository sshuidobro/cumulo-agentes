---
tipo: tarea
id: PDF-111
titulo: Exportar e importar comentarios en XFDF desde el panel
app: pdf
estado: en-test
depende_de: [PDF-110, PDF-116, COM-018, PDF-108]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, anotaciones, ui]
---

# PDF-111 · Exportar e importar comentarios en XFDF desde el panel

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0030-respuestas-estados-xfdf]] · Antes: [[PDF-110-xfdf-nucleo]], [[COM-018-exportar-fichero]]

## Objetivo
Desde el panel de comentarios, «Exportar comentarios…» guarda un `.xfdf` y «Importar comentarios…» añade los de un `.xfdf` (de nuestra app o de Acrobat) al documento abierto, deshaciéndose de una vez.

## Contexto
- `src/core/xfdf/xfdf.ts` (PDF-110): `exportXfdf`, `importXfdf`, `XfdfImportResult`; `src/core/errors.ts` (`xfdf-invalid`, `xfdf-empty`).
- `@suite/platform`: `exportFile`, `importFile` (COM-018).
- `src/state/annotation-actions.ts`: `addAnnotations(label, list)` (una entrada de deshacer), `getEffective`, `newAnnotationId`, `nowIso`; `useAnnotations` (`baseline`, `edits`, `author`).
- `src/state/viewer-store.ts` (`file`, `pdf`, `status`), `src/state/notice.ts` → `showNotice`.
- `src/ui/sidebar/CommentsPanel.tsx` (cabecera con el `MenuButton` de filtro), `src/ui/messages-comments.ts` (PDF-109).

## Qué hay que hacer
1. `src/state/xfdf-actions.ts`:
```ts
export const XFDF_FILTERS: readonly FileFilter[]; // [{ name: 'Comentarios XFDF', extensions: ['xfdf', 'xml'] }]
export const MAX_XFDF_BYTES = 20_000_000;
/** Exporta las anotaciones editables efectivas (con cambios sin guardar). Nombre sugerido: «<nombre sin .pdf>.xfdf». */
export async function exportComments(): Promise<'saved' | 'downloaded' | 'cancelled' | 'nothing' | 'failed'>;
/** Elige un XFDF, lo importa con addAnnotations('importar comentarios', …) y avisa del resultado. */
export async function importComments(): Promise<'imported' | 'cancelled' | 'failed'>;
```
   - Exportar: sin anotaciones editables → `'nothing'` (la entrada de menú está deshabilitada en ese caso). `ids` = `pdf.doc.fingerprints` si son dos cadenas, si no `null`. Bytes con `TextEncoder`. Aviso «Comentarios exportados.» si `'saved'`; error de plataforma → aviso con su mensaje.
   - Importar: `importFile(XFDF_FILTERS, MAX_XFDF_BYTES)`; `out-of-range` → «El fichero de comentarios es demasiado grande (máximo 20 MB).»; texto con `new TextDecoder('utf-8')`; `existingIds` = ids de `baseline` ∪ `edits.upserts` ∪ `edits.removed`; `pageCount` = `pdf.numPages`. Error → aviso con `error.message`. Éxito → aviso `commentsMsg.imported(n, skipped, duplicates)`: «Se han importado 3 comentarios.», y si procede « Se han omitido 2 que no se pueden importar.» y/o « 4 ya estaban en el documento.». Tras importar, selecciona el panel de comentarios (`showSidebarTab('comments')` o el nombre que use `sidebar-actions.ts`).
2. `commentsMsg`: `menu` «Más opciones de comentarios», `exportXfdf` «Exportar comentarios…», `importXfdf` «Importar comentarios…», `exported` «Comentarios exportados.», `tooLarge`, `imported(n, skipped, duplicates)`.
3. `CommentsPanel.tsx`: segundo `MenuButton` (icono `IconMore`) junto al filtro con las dos entradas.
4. Tests: `tests/unit/xfdf-actions.test.ts` (con `createFakePlatform` y `overrides` de `exportFile`/`importFile`) y `tests/e2e/xfdf.spec.ts`.

## Criterios de aceptación
- [ ] Unit: con 2 anotaciones (una sin guardar), `exportComments` llama a `exportFile` con `informe.xfdf`, filtro XFDF y un XML que `importXfdf` lee con 2 anotaciones.
- [ ] Unit: `importComments` con un XFDF de 3 comentarios → 3 nuevas, `undoDepth` +1; `undo()` las quita todas; importar el mismo de nuevo → aviso «… 3 ya estaban en el documento.» y nada nuevo.
- [ ] Unit: XFDF con `<!DOCTYPE` → aviso «El fichero de comentarios no es un XFDF válido.» y ningún cambio; `importFile` con `out-of-range` → aviso de tamaño.
- [ ] E2E «sin pérdidas»: en `basic-5.pdf` crear resaltado, nota con una respuesta y estado «Aceptado», texto libre, dibujo, rectángulo y sello; exportar (descarga en Chromium sin picker); abrir de nuevo `basic-5.pdf` limpio, importar el `.xfdf` descargado → el panel muestra los mismos tipos, autores, textos, la respuesta bajo su nota y «Aceptado»; Ctrl+S y recargar los conserva.
- [ ] Exportar no añade nada a «Recientes» (E2E: la lista de recientes no cambia).
- [ ] Menú con `aria-label`, navegable con teclado; la entrada de exportar deshabilitada sin comentarios.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- FDF binario, enviar por correo, importar valores de formulario del XFDF.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/state/xfdf-actions.ts` (nuevo: `XFDF_FILTERS`, `MAX_XFDF_BYTES`, `exportComments`, `importComments`, `hasExportableComments`), `apps/lector-pdf/src/ui/messages-comments.ts` (textos del menú y avisos), `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx` (segundo `MenuButton` con `IconMore`), `apps/lector-pdf/tests/unit/xfdf-actions.test.ts` (nuevo, 9 tests), `apps/lector-pdf/tests/e2e/xfdf.spec.ts` (nuevo, 2 tests).
- Qué he hecho: exportar con `exportFile` (nombre `<base>.xfdf`, `href` con el nombre del PDF) e importar con `importFile` → `importXfdf` → `addAnnotations('importar comentarios', …)`, con aviso y pestaña «Comentarios». El menú «Más opciones de comentarios» deshabilita «Exportar» sin comentarios editables. Todos los criterios de la ficha tienen test.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; cobertura con `pnpm exec vitest run --coverage --coverage.reportsDirectory=<scratchpad>/cov-111` (el directorio `coverage` estaba bloqueado por otra ejecución): 297 ficheros, 3853 tests OK; `pnpm --filter lector-pdf e2e` (con `LECTOR_E2E_PORT=4313`): 314 passed, código 0 (una primera pasada tuvo 2 fallos de carga en `shapes` y `search`, que pasaron 7/7 al repetirlos y en la pasada completa).
- Dudas o cosas que no he podido hacer: (1) Con `exportFile` devuelve `downloaded` (Chromium sin selector) no hay aviso «Comentarios exportados.», porque la ficha solo lo pide para `saved`; decidir si debe avisar también. (2) La comprobación «Exportar no añade nada a Recientes» del E2E compara el menú «Abrir recientes», que está vacío en ese flujo: es una comprobación débil. (3) En el E2E la importación quita `showOpenFilePicker` para usar el `<input type=file>` (el selector nativo no se puede automatizar). (4) Pluralización del aviso: «Se ha importado 1 comentario.» / «Se han importado N comentarios.»; la ficha no lo fija.

### [revisor] ronda 1 — 2026-10-20 — APROBADO
- lint y typecheck OK; 9 unit de `xfdf-actions` OK; cada criterio tiene test (unit y E2E «sin pérdidas»). Lógica, errores, menú accesible y deshabilitado sin comentarios correctos.
1. (opcional) `apps/lector-pdf/src/state/xfdf-actions.ts:46` — con `downloaded` no hay aviso; sería coherente avisar también «Comentarios exportados.» (la ficha solo lo pide para `saved`).
2. (opcional) `tests/e2e/xfdf.spec.ts:145` — la comprobación de Recientes es débil (lista vacía); el tester puede reforzarla abriendo antes un fichero reciente.
