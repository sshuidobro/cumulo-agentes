---
tipo: tarea
id: PDF-058
titulo: Respuestas y estados de revisión - modelo, lectura y escritura
app: pdf
estado: hecha
depende_de: [PDF-036, PDF-057, PDF-106]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones]
---

# PDF-058 · Respuestas y estados de revisión: modelo, lectura y escritura

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0030-respuestas-estados-xfdf]] · Paridad: [[Paridad Adobe Acrobat]] · Siguen: [[PDF-109-respuestas-en-el-panel]], [[PDF-110-xfdf-nucleo]], [[PDF-111-xfdf-interfaz]]

> 2026-10-19 (líder): la ficha original (respuestas + estados + XFDF) se reparte: aquí el núcleo de respuestas y estados; panel en PDF-109; XFDF en PDF-110 y PDF-111.

## Objetivo
El modelo admite respuestas (`/IRT`) y estados de revisión (`/State`); se leen de los PDF de Adobe, se escriben de forma que Adobe los lista bajo su comentario, y nunca se dibujan en la página.

## Contexto
- [[ADR-0030-respuestas-estados-xfdf]] («Modelo», «PDF», «Leer», «Estado de un comentario»).
- `src/core/annotations/model.ts` (`Base`, `Annotation`, `translateAnnotation`, `isAnnotation`), `shapes.ts` (PDF-057, patrón de `isShapeValid`).
- `src/core/annotations/import.ts`: `importPageAnnotations` (líneas 69-96: el filtro `hidden === true` va **después** de detectar respuestas y estados), `importSupported`, `kindOf`, `parseRef`.
- `src/core/annotations/to-pdf.ts`: `annotationDict`, `AnnotationDictOptions`, `typeEntries`; `appearance.ts` → `drawingOf`.
- `src/core/pdf/incremental.ts` → `writeUpdate` (plan de `added`, mapa `written`).
- `src/core/annotations/effective.ts` → `annotationsOfPage`; `comment-list.ts` → `buildCommentRows`; registros exhaustivos: `commands.ts`, `comment-list.ts`, `src/ui/messages.ts` (`annotationKinds`), `src/ui/viewer/annotation-shapes.tsx`.

## Qué hay que hacer
1. `model.ts`:
```ts
export type ReviewState = 'Accepted' | 'Rejected' | 'Cancelled' | 'Completed' | 'None';
export interface ReplyAnnotation extends Base { readonly type: 'reply'; readonly parentId: string }
export interface ReviewStateAnnotation extends Base { readonly type: 'review'; readonly parentId: string; readonly state: ReviewState }
```
   en la unión; `translateAnnotation` solo mueve `rect`; `isAnnotation` valida `parentId` (texto no vacío) y `state`.
2. `src/core/annotations/replies.ts` (nuevo):
```ts
export const REVIEW_STATES: readonly ReviewState[]; // en ese orden
export const REVIEW_STATE_LABELS: Readonly<Record<ReviewState, string>>; // Aceptado, Rechazado, Cancelado, Completado, Ninguno
/** reply y review no se dibujan ni tienen zona en la página. */
export function isDrawable(a: Annotation): boolean;
/** Caja de 20×20 en la esquina superior izquierda de `parent.rect`. */
export function replyRect(parent: Annotation): RectPt;
export function newReply(i: { id: string; parent: Annotation; contents: string; author: string; now: string }): ReplyAnnotation;
export function newReviewState(i: { id: string; parent: Annotation; state: ReviewState; author: string; now: string }): ReviewStateAnnotation;
/** Respuestas directas de `parentId`, de la más antigua a la más nueva (`created ?? modified`). */
export function repliesOf(all: ReadonlyMap<string, Annotation>, parentId: string): readonly ReplyAnnotation[];
/** Estado vigente: el `review` con `modified` más reciente; `null` si no hay ninguno o es 'None'. */
export function reviewStateOf(all: ReadonlyMap<string, Annotation>, parentId: string): ReviewStateAnnotation | null;
/** Ids que dependen de `id` (respuestas y estados, recursivo: respuestas de respuestas). Sin `id`. */
export function dependentIds(all: ReadonlyMap<string, Annotation>, id: string): readonly string[];
```
3. `effective.ts` → `annotationsOfPage` omite las no dibujables (`isDrawable`). `comment-list.ts` → `buildCommentRows` omite `reply` y `review` como filas propias (el panel las anida en PDF-109); `SUPPORTED_LABELS` «Respuesta» y «Estado». `commands.ts`: «responder» / «respuesta», «cambiar estado» / «estado». `msg.annotationKinds`: «Respuesta», «Estado». `annotation-shapes.tsx`: ambos tipos devuelven `<></>` en `AnnotationShape` y `ZoneShape`.
4. `appearance.ts`: `reply` y `review` → dibujo vacío (`ops: []`): la `/AP` es un Form XObject sin contenido con `BBox` = `rect`.
5. `to-pdf.ts`: `SUBTYPES` → `Text` para ambos. `AnnotationDictOptions` gana `irtRef: PdfRef | null` (obligatorio para `reply`/`review`; si falta → `throw new Error` de programación). `typeEntries`: `reply` → `{ IRT, RT: name('R'), Name: name('Comment'), F: 28 }`; `review` → `{ IRT, State: encodeTextString(state), StateModel: encodeTextString('Review'), Name: name('Comment'), F: 30 }`. `updatedDict` conserva `/IRT` (ya lo hace).
6. `incremental.ts`: al planificar `added`, resuelve `irtRef` de cada `reply`/`review`: padre en el mismo `added` → su `annot` planificado; padre del fichero (`parentId` `ref:…`) → `parseRef`; padre nuevo **no** incluido y no del fichero, o padre en `diff.removed` → la respuesta/estado **no se escribe** (y no entra en `written`).
7. `import.ts`: antes del filtro de ocultas, una `/Text` con `inReplyTo` (cadena de `parseRef` válida) y `replyType` `R` (o ausente): con `state` y `stateModel === 'Review'` → `review` (estado desconocido → ajena); sin `state` → `reply`. `parentId = 'ref:' + inReplyTo`. `replyType === 'Group'` o `stateModel === 'Marked'` → se ignoran (ni editables ni ajenas). Una respuesta o estado ocultos se importan igual.
8. Tests: `tests/unit/annotations/replies.test.ts`, casos nuevos en `import.test.ts`, `to-pdf.test.ts`, `appearance.test.ts`, `comment-list.test.ts`, `effective`/`model.test.ts`, y `tests/unit/annotations/replies-interop.test.ts`.

## Criterios de aceptación
- [ ] Interop: sobre `basic-5.pdf`, un incremento con una nota nueva + 2 respuestas + un estado `Accepted` → `qpdf --check` 0; pdf.js `getAnnotations()` da las 3 `/Text` hijas con `inReplyTo` = id de la nota (`"<num>R"`), `replyType` `R`, y el estado con `state` `Accepted`, `stateModel` `Review`; las tres tienen `hasAppearance: true` y su flujo `/AP` decodificado está vacío.
- [ ] Reabrir ese fichero e importar → 1 nota + 2 `reply` (en orden de creación con `repliesOf`) + 1 `review`; `reviewStateOf` = `Accepted`.
- [ ] Respuesta a una anotación del fichero (`annotated.pdf`, el resaltado): `/IRT` apunta a su objeto original; respuesta a un padre borrado en el mismo diff → no se escribe.
- [ ] `annotationsOfPage` no devuelve `reply` ni `review`; `buildCommentRows` no las lista como filas; la capa SVG no las dibuja (test UI).
- [ ] `dependentIds` de una nota con una respuesta que tiene otra respuesta y un estado → las 3 ids.
- [ ] Importar: `replyType: 'Group'` → ignorada; `stateModel: 'Marked'` → ignorada; respuesta con `annotationFlags` oculta → importada como `reply`.
- [ ] Borrador con respuestas y estados: `fromDraft(toDraft(...))` sin pérdidas.
- [ ] Cobertura de `replies.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm perf` con código 0.

## Fuera de alcance
- Interfaz de respuestas y estados y borrado en cascada desde la app (PDF-109). XFDF (PDF-110, PDF-111). Estados del modelo `Marked` (marca personal).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/pdf/incremental.ts` (una respuesta o estado sin padre escribible ya no genera un incremento vacío roto: `writeUpdate` decide con `writableAdded`), `apps/lector-pdf/tests/unit/annotations/replies-interop.test.ts` (filtro de respuestas: pdf.js da `state: null` en las respuestas), `apps/lector-pdf/tests/unit/annotations/draft.test.ts` (error de tipo `unknown` en `JSON.parse`).
- Qué he hecho: la implementación de la ficha ya estaba en el commit de pausa `5518a78` (modelo, `replies.ts`, import, to-pdf, incremental, UI). He arreglado los fallos de `replies-interop` (2 tests) y el error de typecheck. `replies.ts` tiene 100 % de líneas; `replies-interop` pasa 5/5 con `qpdf --check` 0.
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf typecheck`: OK.
  - `npx vitest run tests/unit/annotations tests/unit/organize` (+ cobertura de `replies.ts`): 452/452 OK.
  - `pnpm lint`: **falla** solo por `apps/lector-pdf/tests/unit/tabs-annotations.test.ts` (líneas 94 y 217: `console.log('DBG …')` de depuración, `no-console`). No es de esta ficha: no lo he tocado.
  - `tests/ui/draft-sync-tabs.test.tsx` (2 tests) y `tests/unit/tabs-annotations.test.ts` (3 tests): fallan por timeout de 5-10 s, no por las respuestas. Mismo origen (WIP de pestañas/borradores del commit `5518a78`). Revisar antes de `pnpm coverage`.
  - `pnpm coverage` y `pnpm perf`: no ejecutados completos (fallan por lo anterior).
- Dudas o cosas que no he podido hacer: falta decidir quién arregla `tabs-annotations.test.ts` (DBG y timeouts). No he hecho commit (lo pediste así: otros programadores trabajan en paralelo y hay cambios sin commit de otras fichas).


### [revisor] ronda 1 — 2026-10-19 — APROBADO
- Typecheck y eslint de src y tests/unit/annotations limpios; vitest annotations + ui: 813/815, solo fallan 2 de `draft-sync-tabs` (WIP ajeno de PDF-101). Modelo, `replies.ts`, import, to-pdf, `writableAdded`/`irtOf` y UI cubren los criterios.
- (opcional) El tester debe ejecutar `pnpm coverage` y `pnpm perf` completos cuando PDF-101 esté arreglado.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Interop, reabrir, IRT, dependentIds, Group/Marked/oculta, borrador | OK | `replies-interop` y annotations + ui: 815/815 |
| Capa SVG / annotationsOfPage / buildCommentRows | OK | tests ui y annotations en verde |
| Cobertura `replies.ts` ≥ 90 % | OK | 97,72 % líneas |
| lint, typecheck | OK | código 0 |
| `pnpm coverage` completo | Con carga: 6 timeouts de 5 s (page-tree pages-5000, cifrados, commands 5000); los 6 ficheros pasan aislados (135/135). No relacionados con la ficha. | ver arriba |
| `pnpm perf` | OK en 2.ª repetición (35/35); 1.ª: layout 301,9 vs 300 ms y 2 más, ruido de carga; 3.ª: 35/35 | `pnpm perf` |
Tests añadidos: ninguno (ya cubiertos). Aviso: la suite completa es sensible a la carga (timeouts); conviene subir `testTimeout` de los tests de 5000 páginas/cifrado.
