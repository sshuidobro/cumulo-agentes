---
tipo: tarea
id: PDF-036
titulo: Panel de comentarios - lista, filtros, ir a, editar y borrar
app: pdf
estado: en-test
depende_de: [PDF-031, PDF-015, PDF-033]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: esta ficha (estado `bloqueada`). No he tocado código.
- Qué he hecho: he leído la ficha, el Plan y el código de referencia (`Sidebar.tsx`, `Thumbnails.tsx`, `annotation-store.ts`, `annotation-actions.ts`, `core/annotations/*`, `core/sidebar.ts`). Las dependencias declaradas (PDF-031, PDF-015) están en `hecha`. No he empezado a implementar porque falta una pieza que la ficha da por existente.
- Comandos ejecutados y resultado: ninguno (no había código que comprobar).
- Dudas o cosas que no he podido hacer:
  1. `openPopup(id)` no existe. La ficha la lista en `annotation-actions.ts` (Contexto) y la usa en «Clic o Intro» y en el criterio (T) de Intro y en el E2E («su ventana abierta»). En el código no hay ni `openPopup`, ni `openPopupId` en `annotation-store.ts`, ni nada que abra ventanas de comentario. La define [[PDF-033-notas-emergentes]], que sigue en `pendiente` y no está en `depende_de` de esta ficha.
  2. Además, PDF-033 depende de [[PDF-069-barra-comentar]] (pendiente), así que esta ficha también debe esperar a PDF-069 si se añade PDF-033 a `depende_de`.
  3. La ficha dice «`openPopup(id)` cuando la página esté montada», pero no define cómo se espera a que la página monte (tras `goToPage` puede no estar montada). Eso también debería definirlo PDF-033.
  4. Menor: `IconComment` no existe en `src/ui/icons.tsx`. Lo crearé si se desbloquea; no es el bloqueo.
  Decisión que pido al líder: añadir PDF-033 (y, por ello, PDF-069) a `depende_de` de PDF-036, o decir explícitamente que `openPopup` lo implementa esta ficha. Lo segundo duplicaría trabajo y diseño de PDF-033, así que no lo he hecho.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/comment-list.ts`, `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx` (+ `.module.css`), `apps/lector-pdf/src/ui/sidebar/Sidebar.tsx`, `apps/lector-pdf/src/state/annotation-actions.ts` (`scanAllAnnotations`, `cancelScanAll`, `openPopupWhenPageCurrent`), `apps/lector-pdf/src/state/annotation-store.ts` (`scanCancelable`), `apps/lector-pdf/src/ui/messages.ts` (textos `comments*`), tests `tests/unit/annotations/comment-list.test.ts`, `tests/ui/comments-panel.test.tsx`, `tests/perf/comment-list.perf.test.ts`, `tests/e2e/comments-panel.spec.ts`, `tests/unit/annotations/scan-all.test.ts`.
- Qué he hecho: retomado el trabajo sin commitear. La duda de la ronda 1 queda resuelta: `openPopup` ya existe (PDF-033 está `hecha` y en el commit 146cc1c), así que `openPopupWhenPageCurrent` espera a que la página sea la actual antes de abrir la ventana. Revisado y cerrado el panel: cabecera, filtros, lista virtualizada con teclado, aviso de documento grande con escaneo cancelable, borrado, nombre del autor, y fila activa al seleccionar en la página. No he tocado el código de texto libre (PDF-034) salvo que comparte archivos (`annotation-actions.ts`, `annotation-store.ts`, `messages.ts`, `core/annotations/index.ts`) y lo he dejado como estaba.
- Comandos ejecutados y resultado: `pnpm typecheck` OK; `pnpm lint` OK (0 avisos); `pnpm test` OK (141 ficheros, 1665 tests); `pnpm coverage` OK (`comment-list.ts` 100 % líneas); `pnpm perf` OK en la segunda pasada (24 tests); en la primera falló una vez `annotation-layer.perf.test.ts` (montar 500 anotaciones 126,7 ms frente a 100 ms; al repetirlo, pasa en las dos ejecuciones siguientes, así que es ruido de carga, no de este cambio); `pnpm --filter lector-pdf e2e` OK (141 tests, incluidos los 2 de `comments-panel.spec.ts`).
- Dudas o cosas que no he podido hacer:
  1. No he hecho commit. El árbol mezcla este trabajo con el de PDF-034 (texto libre) en los mismos ficheros (`annotation-actions.ts`, `annotation-store.ts`, `messages.ts`, `core/annotations/index.ts`, `AnnotationLayer.tsx`). Separarlo exige partir hunks, así que lo dejo sin commitear para que el líder o el usuario decidan el reparto de commits.
  2. Quedan fuera de mi alcance los avisos de rendimiento de la capa de anotaciones (`annotation-layer.perf.test.ts`) si vuelven a fallar en carga.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Comprobado: `pnpm lint`, `pnpm typecheck`, `pnpm test` (1665) OK; cobertura OK (con directorio propio porque otro proceso bloqueaba `coverage/`; `comment-list.ts` 100 % líneas); `comment-list.perf.test.ts` OK; E2E `comments-panel` 2/2 OK. Criterios cubiertos, núcleo sin React, textos en `messages.ts`, listbox accesible con teclado.
1. (opcional) `annotation-actions.ts` `openPopupWhenPageCurrent` — la suscripción pendiente no se cancela en `endAnnotationSession`; cancelarla ahí evitaría abrir una ventana tras cerrar el documento.
2. (opcional) `CommentsPanel.tsx` — sin atajo Supr para borrar la fila activa (el botón Borrar sí es alcanzable con Tab).
3. Nota para el líder: el trabajo está sin commitear y mezclado con PDF-034 en `annotation-actions.ts`, `annotation-store.ts`, `messages.ts`, `core/annotations/index.ts`.
