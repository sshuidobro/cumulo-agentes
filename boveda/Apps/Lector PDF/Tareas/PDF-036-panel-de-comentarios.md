---
tipo: tarea
id: PDF-036
titulo: Panel de comentarios - lista, filtros, ir a, editar y borrar
app: pdf
estado: pendiente
depende_de: [PDF-031, PDF-015]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, anotaciones, accesibilidad]
---

# PDF-036 · Panel de comentarios

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
La pestaña «Comentarios» del panel lateral lista todas las anotaciones del documento agrupadas por página (también las de tipos que no editamos, como solo lectura), con filtros por tipo, autor y texto; al elegir una se va a ella y se abre su comentario; se puede borrar; y se configura el nombre de autor. Funciona igual con miles de comentarios.

## Contexto
- Leer: `src/ui/sidebar/Sidebar.tsx`, `Thumbnails.tsx` (patrón de lista virtualizada, PDF-015), `src/state/annotation-store.ts` (`baseline`, `foreign`, `scan`, `scanProgress`, `author`), `annotation-actions.ts` (`getEffective`, `select`, `openPopup`, `deleteAnnotation`, `ensurePageAnnotations`), `src/state/navigation.ts` (`goToPage`).
- Etiquetas de tipo: Resaltado, Subrayado, Tachado, Nota, Texto, Dibujo; ajenas: el `subtype` traducido si se conoce (`Square` Rectángulo, `Circle` Elipse, `Line` Línea, `Polygon` Polígono, `PolyLine` Polilínea, `Stamp` Sello, `Caret` Inserción, `FileAttachment` Adjunto, `Sound` Sonido, `Squiggly` Subrayado ondulado), si no el `subtype` tal cual.

## Qué hay que hacer
1. `src/core/annotations/comment-list.ts` (puro):
   ```ts
   export interface CommentFilter { readonly types: ReadonlySet<string>; readonly author: string | null; readonly text: string } // types vacío = todos; text sin distinguir mayúsculas ni acentos
   export type CommentRow = { readonly kind: 'page'; readonly pageIndex: number; readonly count: number } | { readonly kind: 'item'; readonly id: string; readonly pageIndex: number; readonly typeLabel: string; readonly author: string; readonly modified: string | null; readonly excerpt: string; readonly readOnly: boolean };
   export function buildCommentRows(effective: ReadonlyMap<string, Annotation>, foreign: ReadonlyMap<string, ForeignAnnotation>, f: CommentFilter): CommentRow[]; // por página ascendente; dentro, de arriba abajo (rect y2 desc) y de izquierda a derecha
   export function authorsOf(...): string[]; // ordenados con localeCompare('es')
   ```
   `excerpt`: los 160 primeros caracteres del comentario (sin saltos de línea); si está vacío, para marcado de texto `«sin comentario»`.
2. `src/ui/sidebar/CommentsPanel.tsx` (pestaña «Comentarios», `IconComment`):
   - Cabecera: campo «Tu nombre» (`setAuthor`, al perder el foco), buscador «Buscar en comentarios», `MenuButton` «Filtrar» (casillas por tipo presente + autores), recuento «N comentarios».
   - Lista virtualizada de filas de altura fija (cabecera de página 28 px, comentario 72 px con el extracto en 2 líneas y elipsis) con `role="listbox"` y opciones `role="option"`; ↑/↓, Inicio/Fin, Intro.
   - Fila: icono del tipo con su color, tipo, autor, fecha (`Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' })`), extracto; botón «Borrar» (no en las de solo lectura); las de solo lectura con la etiqueta «solo lectura».
   - Clic o Intro: `goToPage(pageIndex, { yFraction })` con la parte superior del `rect`, `select(id)` y, si es editable, `openPopup(id)` cuando la página esté montada. En las de solo lectura solo navega.
   - Estado del escaneo: `scanning` → «Cargando comentarios… (X de N páginas)»; `lazy` → aviso «Documento muy grande: se muestran los comentarios de las páginas visitadas» y botón «Buscar en todo el documento» que lanza el escaneo completo (`scanAllAnnotations()` nueva en `annotation-actions.ts`, cancelable, con progreso).
   - Vacío: «Este documento no tiene comentarios. Usa la barra «Comentar» para añadir uno.»
3. `Sidebar`: añade la pestaña; el atajo de la barra lateral (F4) conserva la última pestaña.
4. Al seleccionar una anotación en la página, la fila correspondiente se marca y se desplaza a la vista si el panel está abierto.
5. Tests `tests/unit/annotations/comment-list.test.ts`, `tests/ui/comments-panel.test.tsx`, `tests/e2e/comments-panel.spec.ts`.

## Criterios de aceptación
- [ ] (T) `buildCommentRows` sobre las anotaciones de `annotated.pdf` → cabeceras de p1, p2, p3 y 5 + 1 filas; el `Square` como «Rectángulo», `readOnly`; filtro `text 'previo'` (sin acento ni mayúsculas) deja la nota, el texto libre y el resaltado.
- [ ] (T) Con 10 000 anotaciones sintéticas el panel monta < 40 filas en el DOM.
- [ ] (T, rendimiento, `tests/perf/comment-list.perf.test.ts` con `measureBest`) `buildCommentRows` con 10 000 anotaciones sintéticas < 100 ms.
- [ ] (T) Intro sobre una fila llama a `goToPage` con su página, `select` y `openPopup`; sobre una de solo lectura no abre ventana.
- [ ] (T) Cambiar «Tu nombre» a «Ana» → `prefs.annotationAuthor === 'Ana'` y las anotaciones nuevas llevan ese autor.
- [ ] E2E (`annotated.pdf`): abrir la pestaña → 6 comentarios; clic en «Nota previa» → la página 2 visible y su ventana abierta; borrar el resaltado desde el panel → desaparece de la lista y de la página.
- [ ] E2E: con `pages-100000.pdf` la pestaña muestra el aviso de documento grande y el botón inicia el escaneo con progreso visible y se puede cancelar.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Respuestas, estados («Aceptado»…) y exportar/importar comentarios (PDF-058). Ordenar por autor o fecha (mejora futura).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.
