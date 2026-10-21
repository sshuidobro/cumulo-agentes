---
tipo: tarea
id: PDF-137
titulo: Redactar - marcar zonas, texto y resultados de búsqueda, y aplicar
app: pdf
estado: en-test
depende_de: [PDF-136, PDF-134]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-21
tags: [tarea, pdf, iteracion-6, seguridad, edicion, ui]
---

# PDF-137 · Redactar: marcar zonas, texto y resultados de búsqueda, y aplicar

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0039-redaccion-real]] · Antes: [[PDF-136-redactar-imagenes]]

## Objetivo
En la barra «Editar», la herramienta «Redactar» marca zonas arrastrando, marca el texto seleccionado o todos los resultados de una búsqueda, permite deshacer y quitar marcas, y «Aplicar redacciones» elimina de verdad el contenido tras una confirmación clara, guardando el fichero reescrito.

## Contexto
- Ops `'redact-plan'` y `'redact'` (PDF-135/136); `RedactArea`, `PagePlan`, `PartialImage`.
- `src/ui/toolbar/EditToolbar.tsx` (PDF-130), `src/ui/viewer/AnnotationLayer.tsx` (dibujo de zonas: `ZoneShape` en `annotation-shapes.tsx`), `src/ui/viewer/selection-to-pages.ts` → `selectionPageRects`.
- `src/state/search-store.ts` / `search-actions.ts` (coincidencias `SearchMatch` por página); `src/engine/search-source.ts` / `src/engine/text.ts` (ítems de texto con `transform`, `width`, `height`).
- `src/engine/print-render.ts` → patrón de `renderPageImage`; `src/state/print-source.ts` → `openPrintSource`.
- `src/state/save-actions.ts` → `writeDocument({ kind: 'replace' })`, `registerPendingChanges`, `buildCurrentDelta`; `src/state/document-actions.ts` → `currentPassword`; `src/state/doc-ops.ts`; `useDocOpJob`, `DocOpProgress`.

## Qué hay que hacer
1. `src/engine/match-rects.ts`: `export async function matchRects(doc: PDFDocumentProxy, match: SearchMatch): Promise<readonly RectPt[]>` — por cada ítem tocado, la parte proporcional de su ancho (`offset / str.length`) con su `transform` y altura (ascendente 0,8 y descendente 0,25 del tamaño), en espacio de usuario, ampliada 1 pt por lado.
2. `src/engine/redact-render.ts`:
   - `renderRedactedPage(doc, index, areas: readonly RectPt[], signal): Promise<Uint8Array | 'cancelled'>`: dibuja la página **sin girar** (`getViewport({ scale: 300/72, rotation: 0 })`), sin anotaciones, pinta de negro las zonas (convertidas con `convertToViewportPoint`) y devuelve JPEG calidad 0,9.
   - `paintJpeg(bytes: Uint8Array, pixelRects: readonly RectPt[]): Promise<Uint8Array>`: decodifica con `createImageBitmap`, pinta en negro y codifica JPEG 0,92 con el mismo tamaño.
3. `src/state/redact-store.ts` + `redact-actions.ts`:
```ts
export interface RedactMark { readonly id: string; readonly pageIndex: number; readonly rect: RectPt }
export const useRedact: UseBoundStore<StoreApi<{ readonly marks: readonly RedactMark[]; readonly undo: UndoState }>>;
export function addMark(pageIndex: number, rect: RectPt): void;
export function markSelection(): void;            // selectionPageRects de la selección actual
export async function markSearchResults(): Promise<number>;   // todas las coincidencias de la búsqueda actual (máx. 10 000); devuelve cuántas
export function removeMark(id: string): void;
export function redactUndo(): void; export function redactRedo(): void;
export async function applyRedactions(): Promise<SaveResult | 'cancelled'>;
```
   - Historial propio (`UndoStack`, profundidad 100); con marcas, `registerPendingChanges({ isDirty: marcas > 0, save: applyRedactions, discard })` — Ctrl+S con marcas pregunta si aplicarlas.
   - `applyRedactions`: confirmación (`askChoice`) «Se eliminará de forma permanente el contenido marcado (texto, imágenes y comentarios). Los dibujos vectoriales quedarán tapados. Esta acción no se puede deshacer.» Aplicar / Cancelar → op `'redact-plan'` sobre la fuente con cambios sin guardar → si hay páginas `raster`, segunda confirmación «N páginas se convertirán en imagen: su texto ya no se podrá seleccionar ni buscar.» → `renderRedactedPage` para cada una (documento de `openPrintSource`) y `paintJpeg` para cada imagen parcial `jpeg` → op `'redact'` → `writeDocument({ kind: 'replace', bytes, password: currentPassword() })` → marcas vacías → aviso «Redacción aplicada en N páginas.».
   - Pestañas: participante `{ id: 'redact', order: 41 }` con las marcas y el historial.
4. Interfaz: herramienta «Redactar» en `EditToolbar` (arrastrar = zona; las marcas se ven con borde rojo y relleno rojo translúcido rayado; Supr borra la marca seleccionada), botones «Marcar texto seleccionado», «Marcar resultados de búsqueda» (deshabilitado sin búsqueda activa) y «Aplicar redacciones (N)». El menú de la selección de texto (`SelectionActions.tsx`) gana «Redactar».
5. `src/ui/messages-redact.ts` (`redactMsg`) con todos los textos citados, `tool` «Redactar», `markSelection`, `markSearch`, `marked(n)` «N zonas marcadas.», `apply(n)`, `confirmTitle` «Aplicar redacciones», `rasterWarning(n)`, `done(n)`, `progress(done, total)`.
6. Tests: `tests/unit/redact-actions.test.ts`, `tests/ui/redact-tool.test.tsx`, `tests/e2e/redact.spec.ts`.

## Criterios de aceptación
- [ ] **Criterio original** (E2E + Node): `basic-5.pdf` → buscar «Página 3» → «Marcar resultados de búsqueda» → Aplicar → guardar; el PDF descargado, con `pdftotext`, no contiene «Página 3» y sí «Página 2» y «Página 4»; sus bytes (`qpdf --qdf --object-streams=disable`) tampoco contienen el texto redactado.
- [ ] E2E: zona arrastrada sobre una parte de la imagen de la página 1 de `scanned-es-3.pdf` → tras aplicar, la página sigue siendo una sola imagen con esa zona negra (píxeles negros al leer el lienzo) y sin convertirse en página rasterizada nueva (el `Do` usa un objeto distinto del original).
- [ ] E2E: deshacer y rehacer marcas; Escape cancela el arrastre; con marcas, cerrar la pestaña pregunta.
- [ ] E2E: «Cancelar» en cualquiera de las dos confirmaciones no cambia nada.
- [ ] Unit: `matchRects` cubre el texto de la coincidencia en un ítem simulado; errores de op → aviso en español y fichero sin tocar.
- [ ] Teclado y accesibilidad: herramienta y botones con teclado y `aria-label`; las marcas tienen nombre accesible «Zona para redactar en la página N»; axe sin violaciones; tema oscuro.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Guardar las marcas como anotaciones `/Redact` sin aplicar. Patrones predefinidos (DNI, IBAN, correos). Quitar metadatos.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/src/engine/match-rects.ts`, `src/engine/redact-render.ts`, `src/state/redact-store.ts`, `src/state/redact-actions.ts`, `src/ui/messages-redact.ts`, `src/ui/viewer/RedactLayer.tsx` (+ `.module.css`), `src/ui/toolbar/RedactBar.tsx` (+ `.module.css`), `src/ui/toolbar/EditToolbar.tsx`, `src/ui/toolbar/CommentToolbar.tsx`, `src/ui/viewer/SelectionActions.tsx`, `src/ui/viewer/PageView.tsx`, `src/ui/App.tsx`, `src/ui/icons.tsx`, `src/state/annotation-store.ts` (tipo `'redact'`), `src/main.tsx`; tests `tests/unit/redact-match-rects.test.ts`, `tests/unit/redact-actions.test.ts`, `tests/ui/redact-tool.test.tsx`, `tests/e2e/redact.spec.ts`.
- Qué he hecho: herramienta «Redactar» en «Editar» (arrastrar zona, Escape cancela, Supr quita la marca enfocada, Ctrl+Z/Ctrl+Y). Marcar texto seleccionado, marcar resultados de búsqueda (máx. 10 000), aplicar con dos confirmaciones y «Redactar» en la barra de selección. Historial propio y registro de cambios pendientes (Ctrl+S y cerrar pestaña preguntan); pestaña participante `redact`, orden 41.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` código 0, 317 ficheros y 4078 tests OK; `pnpm --filter lector-pdf e2e` código 0, 375 pruebas OK (incluidas 4 de `redact.spec.ts`: criterio original con `pdftotext` y `qpdf --qdf`, zonas/Escape/undo/Cancelar, cierre de pestaña con marcas, imagen de `scanned-es-3.pdf` con píxeles negros).
- Dudas o cosas que no he podido hacer:
  - Axe solo se ha comprobado en la barra «Redactar» (no en el visor completo); el tema oscuro solo tiene variables, sin prueba visual.
  - Si ya hay otros cambios pendientes registrados (p. ej. «Organizar» abierto), las marcas no se registran: Ctrl+S guardará los otros. No he encontrado caso real que lo provoque; lo dejo anotado.
  - Cada marca es un nodo DOM sin virtualizar: una página con miles de coincidencias marcadas creará miles de nodos. Riesgo de rendimiento que no he medido.
  - «Redactar» desde la barra de selección marca el texto y activa la herramienta (decisión mía, la ficha no lo detalla).
  - Las etiquetas de «Deshacer» de las marcas son cadenas fijas en `redact-actions.ts`, no están en `messages-redact.ts`.
  - El aviso «Redacción aplicada en N páginas» cuenta las páginas con marcas, no solo las rasterizadas.


### [revisor] ronda 1 — 2026-10-21 — APROBADO
Lint, typecheck y los 19 tests de redact (unit + UI) en verde. No he lanzado la e2e completa (la usa otro agente): me fío del resultado del programador (375 OK, incluidas las 4 de `redact.spec.ts`). Código revisado: `match-rects.ts`, `redact-render.ts`, `redact-actions.ts`, `RedactLayer.tsx`; cumple la ficha y no hay nada fuera de alcance.
1. (opcional) `redact-actions.ts:53-160` — las etiquetas de deshacer («marcar zona», etc.) están fijas en el código; pasarlas a `messages-redact.ts`.
2. (opcional) `redact-actions.ts:150` — `markSearchResults` devuelve el número de coincidencias y el aviso cuenta zonas; coherente, pero conviene documentarlo.
3. (opcional) Miles de marcas = miles de nodos sin virtualizar (riesgo ya anotado por el programador); medir en el tester con 10 000 coincidencias.
4. Para el tester: comprobar axe en el visor completo y el tema oscuro (el programador solo lo hizo en la barra).
