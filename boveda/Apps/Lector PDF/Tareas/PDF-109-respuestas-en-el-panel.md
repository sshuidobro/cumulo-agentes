---
tipo: tarea
id: PDF-109
titulo: Responder y cambiar el estado desde la ventana del comentario
app: pdf
estado: pendiente
depende_de: [PDF-058, PDF-101]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones, ui]
---

# PDF-109 · Responder y cambiar el estado desde la ventana del comentario

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0030-respuestas-estados-xfdf]] · Antes: [[PDF-058-respuestas-xfdf]] · Sigue: [[PDF-116-hilos-en-el-panel]]

## Objetivo
En la ventana emergente de un comentario se ven sus respuestas (autor, fecha, texto), se puede responder, editar o borrar una respuesta propia y fijar el estado (Aceptado, Rechazado, Cancelado, Completado, Ninguno). Borrar un comentario borra sus respuestas y estados en un solo paso de deshacer.

## Contexto
- [[ADR-0030-respuestas-estados-xfdf]].
- `src/core/annotations/replies.ts` (PDF-058): `newReply`, `newReviewState`, `repliesOf`, `reviewStateOf`, `dependentIds`, `REVIEW_STATES`, `REVIEW_STATE_LABELS`.
- `src/ui/viewer/AnnotationPopup.tsx` → `CommentDialog` (estructura, foco, Escape, `onDelete`) y `AnnotationPopup.module.css`.
- `src/state/annotation-actions.ts`: `deleteAnnotation` (línea ~488), `addAnnotation`, `updateAnnotation`, `newAnnotationId`, `nowIso`, `getEffective`, el `stack.group` de `addAnnotations` (patrón de una entrada de deshacer), `useAnnotations.author`.
- `src/ui/kit/MenuButton.tsx`, `src/ui/icons.tsx`.

## Qué hay que hacer
1. `src/state/reply-actions.ts`:
```ts
/** Añade una respuesta de `author` actual a `parentId`; texto recortado; vacío → no hace nada y devuelve null. Una entrada «responder». */
export function addReply(parentId: string, text: string): string | null;
/** Cambia el texto de una respuesta (agrupa la ráfaga con mergeKey `reply-text:<id>`). */
export function editReply(id: string, text: string): void;
/** Nuevo `review` del autor actual; si el vigente ya es ese estado, no hace nada. Una entrada «cambiar estado». */
export function setReviewState(parentId: string, state: ReviewState): void;
```
2. `annotation-actions.ts` → `deleteAnnotation(id)`: borra `id` **y** `dependentIds(getEffective(), id)` dentro de un `stack.group('borrar …')` (una sola entrada de deshacer; la etiqueta es la del padre). Deshacer devuelve todo.
3. `src/ui/messages-comments.ts` (`commentsMsg`): `replies` «Respuestas», `replyField` «Escribe una respuesta», `replyButton` «Responder», `replyEdit` «Editar respuesta», `replyDelete` «Borrar respuesta», `stateMenu` «Estado», `stateLabel(state)` «Estado: Aceptado»…, `stateNone` «Sin estado», `replyCount(n)` «1 respuesta» / «N respuestas».
4. `CommentDialog` (o un componente nuevo `src/ui/viewer/ReplyThread.tsx` que él monta debajo del `textarea`):
   - Lista de respuestas (`repliesOf`) con autor, fecha (mismo `DATE_FORMAT`) y texto; cada una con botones de icono «Editar» (convierte el texto en `textarea`; Intro sin Mayús o perder el foco confirma, Escape cancela) y «Borrar» (`deleteAnnotation` de la respuesta).
   - Campo «Escribe una respuesta» + botón «Responder» (Ctrl+Intro también responde); tras responder el campo se vacía y conserva el foco.
   - Botón de menú «Estado» en el pie con las cinco opciones (la vigente marcada) → `setReviewState`. El estado vigente se muestra en la cabecera («Estado: Aceptado») con `aria-live="polite"`.
   - La lista es desplazable (máx. 240 px de alto) para hilos largos.
5. Tests: `tests/unit/annotations/reply-actions.test.ts`, `tests/ui/annotation-popup.test.tsx` (casos nuevos) y `tests/e2e/replies.spec.ts`.

## Criterios de aceptación
- [ ] Unit: `addReply` con texto «  ok  » crea una `reply` «ok» del autor actual con `parentId`; con «   » no crea nada. `setReviewState('Accepted')` dos veces seguidas → un solo `review`.
- [ ] Unit: borrar una nota con 2 respuestas y un estado → los 4 desaparecen de `getEffective()` y `undoDepth` sube 1; Ctrl+Z (`undo`) los devuelve todos.
- [ ] UI: en la ventana de una nota, escribir y pulsar «Responder» añade la respuesta a la lista y vacía el campo; Escape en el campo de respuesta cierra la ventana (como el comentario); editar y borrar una respuesta funcionan con teclado.
- [ ] E2E (`basic-5.pdf`): crear una nota, responder dos veces, marcar «Aceptado», Ctrl+S, recargar → abrir la nota muestra las 2 respuestas en orden y «Estado: Aceptado»; en la página no aparecen iconos extra (mismo número de zonas `[data-annot-id]` que antes de responder).
- [ ] E2E: abrir el resultado anterior y comprobar con `qpdf --json` (en el test, sobre el fichero descargado/guardado) que las respuestas tienen `/IRT` a la nota y el estado `/F 30`.
- [ ] Accesibilidad: controles con `aria-label`; axe sin violaciones nuevas en la ventana con respuestas (`tests/e2e/annotations-a11y.spec.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Respuestas en la lista del panel (PDF-116). Respuestas a anotaciones ajenas de solo lectura (no tienen ventana editable). XFDF (PDF-110, PDF-111). Notificaciones o menciones.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
