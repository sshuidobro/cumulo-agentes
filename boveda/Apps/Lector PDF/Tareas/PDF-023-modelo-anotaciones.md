---
tipo: tarea
id: PDF-023
titulo: Modelo de anotaciones y comandos deshacibles (núcleo)
app: pdf
estado: pendiente
depende_de: [PDF-001]
intentos: 0
skills: [stack-typescript-react, formatos-ofimatica, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, anotaciones, undo]
---

# PDF-023 · Modelo de anotaciones y comandos

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0005-modelo-deshacer-rehacer]] · Manual de UndoStack: [[Apps/Comun/Manual|Manual de Comun]]

## Objetivo
Tipos inmutables para resaltado, subrayado, tachado, nota, texto libre y dibujo (en coordenadas PDF), un modelo de **cambios** sobre la línea base del fichero, un único comando primitivo deshacible y la diferencia que usará el escritor al guardar.

## Contexto
- Leer: [[ADR-0009-anotaciones-escritor-incremental]], `packages/shared/src/undo/types.ts` (`Command<D>`), manual de `UndoStack` (sección "Definir comandos").
- **Por qué "cambios" y no "lista completa":** las anotaciones del fichero se importan poco a poco en segundo plano (PDF-024); la línea base no puede vivir dentro del `UndoStack`. El documento del `UndoStack` es `AnnotationEdits` (lo que el usuario cambió); lo que se ve es `baseline ⊕ edits`.
- Coordenadas: puntos PDF del espacio de usuario de la página (origen abajo-izquierda, sin rotar). Colores RGB en [0, 1].
- Solo `core/`. Sin `Date.now()` ni aleatorios dentro de comandos: la hora y los ids los pasa quien crea el comando.

## Qué hay que hacer
1. `src/core/annotations/model.ts`:
   ```ts
   export type Rgb = readonly [number, number, number];
   export type RectPt = readonly [number, number, number, number];               // x1, y1, x2, y2 con x1 <= x2, y1 <= y2
   export type Quad = readonly [number, number, number, number, number, number, number, number]; // orden Z: x1,y2, x2,y2, x1,y1, x2,y1
   export interface PdfObjRef { readonly num: number; readonly gen: number }
   export type AnnotationOrigin = { readonly kind: 'new' } | { readonly kind: 'file'; readonly ref: PdfObjRef; readonly popupRef: PdfObjRef | null };
   interface Base {
     readonly id: string;                  // nuevas: 'suite-<uuid>'; del fichero: 'ref:<num>R' o 'ref:<num>R<gen>' si gen > 0
     readonly pageIndex: number;
     readonly rect: RectPt;
     readonly color: Rgb;
     readonly opacity: number;             // 0..1
     readonly contents: string;            // comentario
     readonly author: string;
     readonly modified: string;            // ISO 8601
     readonly created: string | null;
     readonly origin: AnnotationOrigin;
   }
   export interface TextMarkupAnnotation extends Base { readonly type: 'highlight' | 'underline' | 'strikeout'; readonly quads: readonly Quad[] }
   export type NoteIcon = 'Comment' | 'Note' | 'Key' | 'Help' | 'NewParagraph' | 'Paragraph' | 'Insert';
   export interface NoteAnnotation extends Base { readonly type: 'note'; readonly icon: NoteIcon; readonly open: boolean }
   export interface FreeTextAnnotation extends Base { readonly type: 'freetext'; readonly fontSize: number; readonly textColor: Rgb } // el texto es `contents`
   export interface InkAnnotation extends Base { readonly type: 'ink'; readonly paths: readonly (readonly number[])[]; readonly width: number } // [x0,y0,x1,y1,...]
   export type Annotation = TextMarkupAnnotation | NoteAnnotation | FreeTextAnnotation | InkAnnotation;
   export type AnnotationType = Annotation['type'];
   export interface AnnotationEdits { readonly upserts: ReadonlyMap<string, Annotation>; readonly removed: ReadonlySet<string> }
   export const EMPTY_EDITS: AnnotationEdits;
   export function fileAnnotationId(ref: PdfObjRef): string;
   export function quadFromRect(r: RectPt): Quad;
   export function rectFromQuads(quads: readonly Quad[]): RectPt;  // caja que los contiene
   export function rectFromPaths(paths: readonly (readonly number[])[], pad: number): RectPt;
   export function translateAnnotation(a: Annotation, dx: number, dy: number): Annotation; // mueve rect, quads o paths
   export function isAnnotation(v: unknown): v is Annotation; // validación completa (para borradores, PDF-038)
   ```
2. `src/core/annotations/effective.ts`:
   ```ts
   export function effectiveAnnotations(baseline: ReadonlyMap<string, Annotation>, edits: AnnotationEdits): ReadonlyMap<string, Annotation>;
     // orden: las de la línea base en su orden (sustituidas si hay upsert, omitidas si están en removed), después las nuevas en orden de inserción
   export function annotationsOfPage(all: ReadonlyMap<string, Annotation>, pageIndex: number): readonly Annotation[];
   ```
3. `src/core/annotations/commands.ts`:
   ```ts
   export function setEntryCommand(label: string, id: string, upsert: Annotation | undefined, removed: boolean, mergeKey?: string): Command<AnnotationEdits>;
     // apply: copia upserts/removed y fija el estado de `id`; invert(before): setEntryCommand(label, id, before.upserts.get(id), before.removed.has(id))
   export function addAnnotationCommand(a: Annotation): Command<AnnotationEdits>;                       // etiqueta según tipo: «añadir resaltado», «añadir subrayado», «añadir tachado», «añadir nota», «añadir texto», «añadir dibujo»
   export function updateAnnotationCommand(next: Annotation, label?: string, mergeKey?: string): Command<AnnotationEdits>; // por defecto «editar comentario»
   export function deleteAnnotationCommand(current: Annotation): Command<AnnotationEdits>;               // nueva → quita el upsert; del fichero → removed = true; etiqueta «borrar <tipo>»
   ```
4. `src/core/annotations/diff.ts`:
   ```ts
   export interface AnnotationDiff { readonly added: readonly Annotation[]; readonly modified: readonly Annotation[]; readonly removed: readonly Annotation[] }
   export function annotationEquals(a: Annotation, b: Annotation): boolean; // comparación profunda de todos los campos
   export function diffAnnotations(baseline: ReadonlyMap<string, Annotation>, edits: AnnotationEdits): AnnotationDiff;
     // added: upserts con origin 'new' (en orden); modified: upserts con origin 'file' distintos de su línea base; removed: entradas de la línea base cuyo id está en removed
   export function isEmptyDiff(d: AnnotationDiff): boolean;
   ```
5. `src/core/pdf-date.ts`: `export function parsePdfDate(s: string | null | undefined): string | null` (`D:YYYYMMDDHHmmSSOHH'mm'` con partes opcionales → ISO 8601 en UTC; inválida → `null`) y `export function toPdfDate(iso: string): string` (`D:YYYYMMDDHHmmSSZ`, UTC). Test `tests/unit/pdf-date.test.ts`.
6. `src/core/annotations/index.ts` reexporta todo. Tests en `tests/unit/annotations/` con un `UndoStack<AnnotationEdits>` real de `@suite/shared`.

## Criterios de aceptación
- [ ] (T) Para cada uno de los 3 creadores: `apply` y luego `invert(before).apply` devuelve un estado igual al de partida (`upserts` y `removed` iguales en contenido) — con anotaciones nuevas y del fichero.
- [ ] (T) Con `UndoStack`: añadir 3, editar 1, borrar 1 del fichero → `diffAnnotations` da 3 añadidas (1 de ellas editada), 0 modificadas, 1 borrada; `undo` ×5 → diff vacío; `redo` ×5 → igual que antes.
- [ ] (T) Editar una del fichero y volver a dejarla igual → no aparece en `modified`.
- [ ] (T) Borrar una anotación **nueva** → no aparece en `removed` ni en `added`.
- [ ] (T) `effectiveAnnotations` respeta el orden descrito; `annotationsOfPage` filtra por página.
- [ ] (T) `updateAnnotationCommand(x, 'escribir', 'note-text:id')` dos veces en < 500 ms se agrupan en una entrada (reloj falso del `UndoStack`).
- [ ] (T) `quadFromRect([10,20,110,40])` → `[10,40, 110,40, 10,20, 110,20]`; `translateAnnotation` de un dibujo mueve todos los puntos y el `rect`.
- [ ] (T) `isAnnotation` acepta los 6 tipos válidos y rechaza: color con 2 componentes, `opacity 2`, `quads` con 7 números, `type 'square'`, `pageIndex -1`, campos que faltan.
- [ ] (T) Rendimiento: 5 000 `addAnnotationCommand` seguidos con `UndoStack` (`maxDepth 100`) en < 2 s (anota el tiempo).
- [ ] (T) `parsePdfDate("D:20261017120000Z")` → `2026-10-17T12:00:00.000Z`; `"D:20261017140000+02'00'"` → `2026-10-17T12:00:00.000Z`; `"D:2026"` → `2026-01-01T00:00:00.000Z`; `"basura"` → `null`; `parsePdfDate(toPdfDate(x)) === x` para 3 fechas con milisegundos 0.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `src/core/annotations/` y `pdf-date.ts` ≥ 95 % de líneas.

## Fuera de alcance
- Leer anotaciones del PDF (PDF-024), apariencias (PDF-027), escribir (PDF-028), interfaz (PDF-030+). Respuestas y estados (PDF-058).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
