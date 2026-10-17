---
tipo: tarea
id: PDF-030
titulo: Estado de anotaciones por documento, deshacer/rehacer y atajos
app: pdf
estado: en-test
depende_de: [PDF-023, PDF-024, PDF-009, COM-011]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, anotaciones, undo]
---

# PDF-030 · Estado de anotaciones, deshacer/rehacer y atajos

> [!note] Alcance reducido por el líder (2026-10-17)
> La parte de interfaz (barra «Comentar», botones en `MainToolbar`) pasa a [[PDF-069-barra-comentar]]; el cursor por herramienta y la llamada a `ensurePageAnnotations` desde `PageView` pasan a [[PDF-031-capa-de-anotaciones]]. Ver Registro.

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0005-modelo-deshacer-rehacer]]

## Objetivo
Al abrir un PDF se importan sus anotaciones (todas si tiene ≤ 20 000 páginas, por páginas visitadas si tiene más); cada cambio pasa por un `UndoStack`; Ctrl+Z / Ctrl+Y / Ctrl+Mayús+Z deshacen y rehacen; el título muestra «•» con cambios sin guardar; y existe la barra «Comentar» con las herramientas, la paleta de colores y el grosor, lista para que las fichas siguientes conecten cada herramienta.

## Contexto
- Leer: `src/core/annotations/*` (PDF-023), `src/engine/annotations-import.ts` (PDF-024), `src/state/viewer-store.ts`, `document-actions.ts` (PDF-008), `src/ui/shortcuts.ts`, `use-shortcuts.ts`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/kit/IconButton.tsx`, `src/ui/kit/MenuButton.tsx` (PDF-020), `packages/shared/src/undo/*` (`UndoStack`, `group`, `closeGroup`).
- Ctrl+Z **no** va en `ALLOW_IN_EDITABLE`: dentro de un `textarea` (nota, texto libre) actúa el deshacer nativo del campo.

## Qué hay que hacer
1. `src/state/annotation-store.ts`:
   ```ts
   export type AnnotationTool = 'none' | 'highlight' | 'underline' | 'strikeout' | 'note' | 'freetext' | 'ink';
   export interface AnnotationState {
     readonly baseline: ReadonlyMap<string, Annotation>;      // importadas del fichero
     readonly foreign: ReadonlyMap<string, ForeignAnnotation>;
     readonly importedPages: ReadonlySet<number>;
     readonly scan: 'idle' | 'scanning' | 'done' | 'lazy';    // 'lazy' = documento > 20 000 páginas
     readonly scanProgress: number;                           // páginas importadas
     readonly edits: AnnotationEdits;
     readonly undo: UndoState;
     readonly selectedId: string | null;
     readonly tool: AnnotationTool;
     readonly colors: Readonly<Record<Exclude<AnnotationTool, 'none'>, Rgb>>;
     readonly inkWidth: 1 | 2 | 4 | 8;
     readonly fontSize: 8 | 10 | 12 | 14 | 18 | 24;
     readonly author: string;
     readonly commentBarOpen: boolean;
     readonly pageVersion: ReadonlyMap<number, number>;       // sube cuando cambian las anotaciones de una página (para redibujar)
   }
   export const useAnnotations: UseBoundStore<StoreApi<AnnotationState>>;
   ```
2. `src/core/annotations/palette.ts`: `export const PALETTE: readonly { readonly id: string; readonly label: string; readonly rgb: Rgb }[]` = amarillo `[1, 0.92, 0.23]`, verde `[0.4, 0.73, 0.42]`, azul `[0.26, 0.65, 0.96]`, rosa `[0.93, 0.25, 0.48]`, naranja `[1, 0.65, 0.15]`, rojo `[0.9, 0.22, 0.21]`. Por defecto: resaltar amarillo, subrayar azul, tachar rojo, nota amarillo, texto libre rojo, dibujo rojo.
3. `src/state/annotation-actions.ts` (el `UndoStack<AnnotationEdits>` vive en un módulo, uno por documento, `maxDepth 100`):
   ```ts
   export function startAnnotationSession(pdf: LoadedPdf, signal: AbortSignal): void; // lo llama openDocument tras 'ready'; reinicia estado y pila; ≤ 20 000 págs → scanAnnotations (onBatch fusiona en baseline/foreign y sube pageVersion de esas páginas); si no, scan 'lazy'
   export function endAnnotationSession(): void;                                      // lo llama closeDocument
   export async function ensurePageAnnotations(pageIndex: number): Promise<void>;     // modo 'lazy': importa la página si falta (PageView la llama al hacerse visible)
   export function newAnnotationId(): string;                                         // 'suite-' + crypto.randomUUID()
   export function nowIso(): string;
   export function addAnnotation(a: Annotation): void;
   export function addAnnotations(label: string, list: readonly Annotation[]): void;  // una sola entrada de deshacer (stack.group)
   export function updateAnnotation(next: Annotation, label?: string, mergeKey?: string): void;
   export function deleteAnnotation(id: string): void;
   export function undo(): void; export function redo(): void; export function closeUndoGroup(): void;
   export function select(id: string | null): void;                                 // cambia de selección → closeUndoGroup
   export function setTool(t: AnnotationTool): void; export function setToolColor(t: Exclude<AnnotationTool, 'none'>, c: Rgb): void;
   export function setInkWidth(w: 1 | 2 | 4 | 8): void; export function setFontSize(s: AnnotationState['fontSize']): void;
   export function setAuthor(name: string): void;                                   // recorta; vacío → 'Usuario'
   export function markAnnotationsSaved(): void;
   export function getEffective(): ReadonlyMap<string, Annotation>;                 // effectiveAnnotations memoizado por (baseline, edits)
   ```
   - Cada cambio sube `pageVersion` de las páginas afectadas (antes y después, por si se mueve de página).
   - Preferencias (`prefs`, con *guards*): `annotationAuthor` (por defecto `'Usuario'`), `annotationColors`, `inkWidth`, `fontSize`, `commentBarOpen`.
   - Título: suscríbete al estado `undo.isDirty` y llama a `platform.setTitle(windowTitle(file.name, isDirty))`.
4. Atajos (`src/ui/shortcuts.ts`): `undo` `Mod+Z`; `redo` `Mod+Y` y `Mod+Shift+Z` (la barra «Comentar» no tiene atajo: `Mod+Shift+C` lo usa el navegador). `Escape` en el visor con herramienta activa → `setTool('none')`.
5. UI: **(movido: barra y botones a [[PDF-069-barra-comentar]]; cursor a [[PDF-031-capa-de-anotaciones]]. En esta ficha solo quedan los botones provisionales Deshacer/Rehacer en la cabecera de `App.tsx`.)**
   - `MainToolbar`: botones «Deshacer» / «Rehacer» (`IconUndo`, `IconRedo`; deshabilitados según `undo`; `title` con la etiqueta: «Deshacer añadir resaltado (Ctrl+Z)») y botón conmutador «Comentar» (`IconComment`, `aria-pressed`).
   - `src/ui/toolbar/CommentToolbar.tsx`: segunda fila `role="toolbar"` `aria-label="Comentar"`, visible si `commentBarOpen`: 6 `IconButton` con `aria-pressed` (Resaltar, Subrayar, Tachar, Nota, Texto, Dibujar; iconos nuevos), un `MenuButton` «Color» con la paleta (`menuitemradio`, muestra de color + nombre) que aplica a la herramienta activa, un `MenuButton` «Grosor» (1, 2, 4, 8 pt; solo con Dibujar) y uno «Tamaño de letra» (solo con Texto). Navegación con flechas dentro de la barra (patrón *toolbar*, `tabindex` itinerante).
   - Cursor del visor según herramienta (`crosshair` para nota/texto/dibujo, `text` para marcado).
6. Mensajes en `messages.ts` para todo lo anterior. Tests `tests/ui/annotation-actions.test.ts`, `tests/ui/comment-toolbar.test.tsx`.

## Criterios de aceptación
- [ ] (T) Abrir `annotated.pdf` (motor real *legacy*) → al terminar el escaneo `baseline` tiene 5 soportadas, `foreign` 1 (`Square`), `scan 'done'`.
- [ ] (T) Con un documento simulado de 25 000 páginas → `scan 'lazy'`; `ensurePageAnnotations(7)` importa solo la página 7 (una llamada a `getAnnotations`) y una segunda llamada no vuelve a importar.
- [ ] (T) `addAnnotation` ×2, `deleteAnnotation` ×1, `undo` → la borrada vuelve; `redo` → se borra; `undo.isDirty` y el título (`setTitle` espía) muestran `• ` mientras haya cambios y no tras `markAnnotationsSaved`.
- [ ] (T) `addAnnotations('resaltar', [a, b])` → `undoDepth` 1 y un `undo` quita las dos.
- [ ] (T) Ctrl+Z con el foco en el visor deshace; con el foco en un `textarea` **no** llama a `undo()`. Ctrl+Y y Ctrl+Mayús+Z rehacen.
- [ ] (T) Cambiar el color de «Resaltar» se guarda en `prefs` y sobrevive a recrear el store; autor vacío → `'Usuario'`.
- [ ] ~~(T) `CommentToolbar`: flechas mueven el foco entre herramientas; el menú de grosor solo existe con Dibujar activo; `aria-pressed` refleja la herramienta.~~ Movido a [[PDF-069-barra-comentar]].
- [ ] (T) Cerrar el documento durante el escaneo lo aborta (sin `set` posteriores: espía del store).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Dibujar las anotaciones (PDF-031) y el comportamiento de cada herramienta (PDF-032 a PDF-035). Guardar (PDF-037).
- Barra «Comentar», botones en `MainToolbar` ([[PDF-069-barra-comentar]]); cursor por herramienta y `ensurePageAnnotations` al hacerse visible una página ([[PDF-031-capa-de-anotaciones]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/palette.ts` (nuevo), `src/state/annotation-store.ts` (nuevo), `src/state/annotation-actions.ts` (nuevo), `src/state/document-actions.ts` (inicia y cierra la sesión de anotaciones), `src/ui/shortcuts.ts` (`undo`, `redo`, `cancel-tool`), `src/ui/use-shortcuts.ts` sin cambios, `src/ui/messages.ts` (textos de deshacer/rehacer), `src/ui/icons.tsx` (`IconUndo`, `IconRedo`), `src/ui/App.tsx` (botones Deshacer/Rehacer y atajo Escape), `tests/unit/annotations/annotation-actions.test.ts` (nuevo), `tests/ui/annotation-shortcuts.test.tsx` (nuevo), `tests/ui/open.test.tsx` (el mock del motor añade `scanAnnotations`), esta ficha.
- Qué he hecho: store zustand `useAnnotations` y acciones sobre `UndoStack<AnnotationEdits>` (una pila por documento, `maxDepth 100`, título con «• » según `isDirty`, preferencias con guards). Al abrir: escaneo completo hasta 20 000 páginas y modo `lazy` con `ensurePageAnnotations` (dedupe por página). Cerrar aborta el escaneo sin `set` posteriores. Atajos Ctrl+Z, Ctrl+Y, Ctrl+Mayús+Z y Esc (solo con herramienta activa); fuera de los campos de texto, como indica la ficha.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (73 ficheros, 918 tests). `pnpm coverage` falla en 2 tests de `tests/unit/pdf/xref-robustness.test.ts` (fichero de PDF-026, sin commitear por otro agente) por timeout de 60 s bajo cobertura; no es de esta ficha. Cobertura de los módulos nuevos: `core/annotations` 97,9 % líneas 99,6 %; `palette.ts` 91,7 %. Los 10 tests de acciones pasan con `annotated.pdf` real (5 soportadas, 1 `Square` ajena, escaneo `done`).
- Dudas o cosas que no he podido hacer:
  1. **Bloqueo de dependencias.** La ficha usa `MainToolbar` (la crea PDF-011, pendiente), `MenuButton` (PDF-020, pendiente) y `PageView` (PDF-010, en curso), pero `depende_de` no los incluye. Sin ellos no puedo hacer `CommentToolbar` (criterio de la barra: aria-pressed, flechas, menú de grosor solo con Dibujar), ni el cursor por herramienta, ni llamar a `ensurePageAnnotations` al hacerse visible una página. Pregunta al líder: ¿añadir a `depende_de` PDF-010, PDF-011 y PDF-020, o autorizar un `MenuButton` provisional aquí?
  2. Decisiones menores tomadas por mí: grosor por defecto 2 pt (la ficha no lo fija); `setCommentBarOpen` añadido (el conmutador lo necesita); los botones Deshacer/Rehacer van en la cabecera de `App.tsx` porque `MainToolbar` no existe aún; los tests de acciones están en `tests/unit/annotations/` porque `vitest.config.ts` solo incluye `tests/ui/*.test.tsx`; si el escaneo falla, `scan` queda en `done` con un aviso en el log (revisar si debe ser un estado de error).
  3. Commit: solo los ficheros de esta ficha. `messages.ts` tiene también una línea `pageRenderFailed` de PDF-010 que no he commiteado.

### [lider] desbloqueo — 2026-10-17
- Decisión: se cierra PDF-030 con lo hecho en `2c71897` (estado, pila de deshacer, acciones, preferencias, título, atajos) → `en-revision`, `intentos` sigue en 0. La parte de UI que dependía de fichas no hechas sale de aquí:
  - Barra «Comentar» (`CommentToolbar`), botón conmutador «Comentar» y traslado de Deshacer/Rehacer a `MainToolbar` → nueva [[PDF-069-barra-comentar]] (`depende_de: [PDF-030, PDF-011, PDF-020]`).
  - Cursor del visor por herramienta y `ensurePageAnnotations` al hacerse visible una página → [[PDF-031-capa-de-anotaciones]] (ya toca `PageView`; gana `PDF-010` en `depende_de`). Así PDF-031 no espera a PDF-020.
- Decisiones menores del programador aceptadas: grosor por defecto 2 pt; `setCommentBarOpen(open)` en las acciones; botones Deshacer/Rehacer provisionales en la cabecera de `App.tsx` (PDF-069 los mueve); tests de acciones en `tests/unit/annotations/` (`vitest.config.ts` incluye `tests/unit/**/*.test.ts`); si el escaneo falla, `scan 'done'` + aviso en el log (el panel de comentarios de PDF-036 mostrará lo importado; no bloquea guardar porque el escritor solo escribe los cambios).
- Para el revisor: criterios a comprobar = todos menos el de `CommentToolbar` (tachado). El fallo de `pnpm coverage` en `tests/unit/pdf/xref-robustness.test.ts` es de [[PDF-026-lector-xref]], no de esta ficha: si sigue fallando, comprobar la cobertura con `pnpm exec vitest run --coverage --exclude '**/xref-robustness.test.ts'` en la raíz y anotarlo; no rechazar PDF-030 por ello. La línea `pageRenderFailed` de `messages.ts` es de PDF-010.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint`, `pnpm typecheck` y `pnpm test` (74 ficheros, 923 tests) con código 0. `pnpm coverage` completo no se ha usado; con `--exclude xref-robustness` pasa (918 tests): `core/annotations` 96,2 % ramas / 97,5 % líneas, `palette.ts` 91,7 %. Todos los criterios vigentes (menos el tachado de `CommentToolbar`) tienen test que falla si se rompen: importación real de `annotated.pdf`, modo lazy con una sola llamada a `getAnnotations`, undo/redo/título, agrupación, atajos con `textarea`, preferencias y aborto sin `set`.
1. (opcional) `annotation-actions.ts:141-143` — si el escaneo falla, `scan` queda en `done` sin aviso al usuario; aceptado por el líder, valorar un estado de error en PDF-036.
2. (opcional) `tests/ui/annotation-shortcuts.test.tsx` — prueba `useShortcuts` con un arnés, no el cableado de `App.tsx`; PDF-069 debería cubrirlo al mover los botones.
