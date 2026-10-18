---
tipo: tarea
id: PDF-016
titulo: Índice (marcadores) del documento en el panel lateral
app: pdf
estado: en-revision
depende_de: [PDF-015, PDF-014]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, navegacion]
---

# PDF-016 · Índice (marcadores)

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
La pestaña «Marcadores» del panel lateral muestra el índice del PDF como un árbol accesible (expandir/contraer, negrita/cursiva, teclado completo), virtualizado para índices enormes. Al activar un marcador se va a su destino (con historial atrás/adelante) o, si es una URL, se pide confirmación como en los enlaces.

## Contexto
- Leer: `src/core/links.ts` (`linkTargetFromAnnotation`, `PdfDest`), `src/state/history.ts` (`navigateToDest`), `src/ui/viewer/LinkLayer.tsx` (diálogo de enlace externo: reutilízalo extrayéndolo a `src/ui/links/confirm-external.tsx` si hace falta), `src/ui/sidebar/Sidebar.tsx`.
- pdf.js `doc.getOutline()` → `null` o array de `{ title, bold, italic, color, dest, url, unsafeUrl, newWindow, count, items, action, attachment }`. `count` > 0 abierto, < 0 cerrado, `undefined` sin hijos/indeterminado.
- Patrón ARIA *tree view* (https://www.w3.org/WAI/ARIA/apg/patterns/treeview/).
- Fixtures: `outline.pdf`, `compressed.pdf` (PDF-003), `libreoffice/informe.pdf` (PDF-004).

## Qué hay que hacer
1. `src/core/outline.ts`:
   ```ts
   export interface RawOutlineItem { readonly title?: unknown; readonly bold?: unknown; readonly italic?: unknown; readonly dest?: unknown; readonly url?: unknown; readonly unsafeUrl?: unknown; readonly action?: unknown; readonly count?: unknown; readonly items?: readonly RawOutlineItem[] }
   export interface OutlineNode { readonly id: string; readonly title: string; readonly bold: boolean; readonly italic: boolean; readonly target: LinkTarget; readonly initiallyExpanded: boolean; readonly children: readonly OutlineNode[] }
   export function toOutlineNodes(raw: readonly RawOutlineItem[] | null): readonly OutlineNode[];
     // id = ruta de índices "0", "0.1", "0.1.0"; título recortado y sin caracteres de control; vacío → "(sin título)"; initiallyExpanded = count > 0
   export interface VisibleRow { readonly node: OutlineNode; readonly depth: number; readonly parentId: string | null }
   export function flattenVisible(nodes: readonly OutlineNode[], expanded: ReadonlySet<string>): readonly VisibleRow[];
   export function initialExpanded(nodes: readonly OutlineNode[]): ReadonlySet<string>;
   export function allIds(nodes: readonly OutlineNode[]): ReadonlySet<string>; // para «Expandir todo»
   ```
   Profundidad máxima 64 (más profundo se ignora) para no reventar con índices maliciosos recursivos.
2. `src/engine/outline.ts`: `export async function getOutline(doc: PDFDocumentProxy): Promise<readonly OutlineNode[]>` (`getOutline()` → `toOutlineNodes`; error → `[]` + logger).
3. Store: `outline: readonly OutlineNode[] | null` (null = cargando), cargado en segundo plano tras abrir.
4. `src/ui/sidebar/OutlinePanel.tsx` (+ CSS Module), pestaña «Marcadores» en `Sidebar`:
   - Barra con «Expandir todo» y «Contraer todo».
   - Árbol `role="tree"`, `aria-label={msg.bookmarks}`, filas `role="treeitem"` con `aria-level`, `aria-expanded` (solo si tiene hijos), `aria-selected` de la fila enfocada; sangría 16 px por nivel; chevrón clicable que alterna; título en negrita/cursiva según el nodo; `title` con el título completo (se recorta con elipsis).
   - Virtualización por filas de alto fijo 28 px (solo filas visibles ± 5 en el DOM).
   - Teclado (foco itinerante, `aria-activedescendant` o `tabIndex` móvil): ↑/↓ fila anterior/siguiente; → expande o va al primer hijo; ← contrae o va al padre; Inicio/Fin; Intro/Espacio activa.
   - Activar: `internal` → `navigateToDest`; `action` → `runNamedAction`; `external` → diálogo de confirmación; `blocked` → `Notice` con `msg.linkBlocked`.
   - Estados: cargando («Cargando marcadores…»), vacío («Este documento no tiene marcadores.»).
5. Mensajes: `bookmarks` «Marcadores», `expandAll` «Expandir todo», `collapseAll` «Contraer todo», `noBookmarks`, `loadingBookmarks`, `untitled` «(sin título)».
6. Tests: `tests/unit/outline.test.ts`, `tests/unit/engine-outline.test.ts` (motor real), `tests/ui/outline-panel.test.tsx`, `tests/e2e/outline.spec.ts`.

## Criterios de aceptación
- [ ] (T) `outline.pdf` → 5 raíces; `Capítulo 1` `bold`; `Capítulo 3` `initiallyExpanded false`; `Sitio web` → `external`; ids `0`, `0.0`, `0.0.0`…
- [ ] (T) `flattenVisible` con `Capítulo 1` expandido y `Sección 1.1` contraída → filas `Capítulo 1 (0)`, `Sección 1.1 (1)`, `Sección 1.2 (1)`, `Capítulo 2 (0)`…
- [ ] (T, rendimiento, `tests/perf/outline.perf.test.ts` con `measureBest`) un árbol generado de 10 000 nodos todos expandidos se aplana en < 50 ms (y da 10 000 filas).
- [ ] (T) Un `RawOutlineItem` con 200 niveles de anidación no lanza y corta en 64.
- [ ] (T) UI: con foco en `Capítulo 1`, `ArrowRight` expande, otra vez va a `Sección 1.1`; `ArrowLeft` vuelve al padre; `Enter` en `Sección 1.1` llama a `navigateToDest`; con 5 000 nodos visibles hay < 60 `treeitem` en el DOM.
- [ ] E2E: `outline.pdf` → pestaña Marcadores → clic en `Anexo` → «Página 30 de 30» visible; `Alt+←` → vuelve; `Sección 1.1` deja visible la parte superior del texto situado en y = 500 de la página 3.
- [ ] E2E: `compressed.pdf` y `libreoffice/informe.pdf` muestran su índice; `basic-5.pdf` muestra «Este documento no tiene marcadores.».
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Crear, renombrar o borrar marcadores (Pro, iteración 6). Resaltar el marcador de la sección actual.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/core/outline.ts`, `src/engine/outline.ts`, `src/state/outline-actions.ts`, `src/ui/sidebar/OutlinePanel.tsx` (+ `.module.css`), `src/ui/links/confirm-external.tsx`, tests `tests/unit/outline.test.ts`, `tests/unit/engine-outline.test.ts`, `tests/ui/outline-panel.test.tsx`, `tests/perf/outline.perf.test.ts`, `tests/e2e/outline.spec.ts`. Modificados: `src/state/viewer-store.ts` (campos `outline`, `outlineExpanded`), `src/state/document-actions.ts` (carga del índice en segundo plano), `src/ui/sidebar/Sidebar.tsx` (pestaña «Marcadores»), `src/ui/viewer/LinkLayer.tsx` (diálogo de enlace externo extraído), `src/ui/messages.ts`.
- Qué he hecho: núcleo puro del índice (validación de cada campo, profundidad máx. 64, ids por ruta, aplanado virtual), motor con `getOutline` que nunca lanza, pestaña «Marcadores» como `role="tree"` virtualizada (filas de 28 px) con teclado completo, activación (interno, acción, externo con confirmación, bloqueado con aviso) y estados de carga y vacío. Se extrajo el diálogo de enlace externo para reutilizarlo y `LinkLayer` lo usa ahora.
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos); `pnpm typecheck` OK; `pnpm test` y `pnpm coverage` OK (121 ficheros, 1455 tests); `pnpm perf` OK (incluye el de 10 000 marcadores); E2E de `outline.spec.ts` con config temporal en el puerto 4399: 4/4 OK. E2E completa de la app en 4399: 72 OK y 1 fallo en `tests/e2e/annotations-layer.spec.ts` («borrar el resaltado con Supr»: `getImageData` sobre un lienzo de tamaño 0), ajeno a esta ficha (anotaciones, PDF-031 en curso). Config temporal y `test-results-4399` borrados.
- Dudas o cosas que no he podido hacer: (1) Decisiones menores: «recortado» = quitar caracteres de control, colapsar blancos y recortar, sin límite de longitud; el estado de despliegue va en el store (`outlineExpanded`, no estaba en la ficha) para no perderlo al cambiar de pestaña. (2) No he hecho commit ni stash: el árbol está compartido con PDF-018, PDF-031 y PDF-037 (las fichas siguen en `en-revision` sin commit propio). (3) `document-actions` importa `getOutline` desde `engine/outline` y no desde el índice de `engine`, porque tests existentes mockean `src/engine` sin esa función.
