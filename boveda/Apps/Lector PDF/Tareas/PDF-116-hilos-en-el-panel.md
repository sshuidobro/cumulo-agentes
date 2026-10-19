---
tipo: tarea
id: PDF-116
titulo: Respuestas y estados en el panel de comentarios
app: pdf
estado: pendiente
depende_de: [PDF-109]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, anotaciones, ui]
---

# PDF-116 · Respuestas y estados en el panel de comentarios

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0030-respuestas-estados-xfdf]] · Antes: [[PDF-109-respuestas-en-el-panel]]

## Objetivo
El panel de comentarios muestra bajo cada comentario sus respuestas (sangradas) y su estado, y se puede filtrar por estado, como en Acrobat.

## Contexto
- `src/core/annotations/comment-list.ts`: `CommentRow`, `CommentFilter`, `EMPTY_COMMENT_FILTER`, `buildCommentRows`, `rowLayout`, `ITEM_ROW_HEIGHT`, `nextItemRow`.
- `src/core/annotations/replies.ts`: `repliesOf`, `reviewStateOf`, `REVIEW_STATE_LABELS`.
- `src/ui/sidebar/CommentsPanel.tsx` (filtros en `filterEntries`, filas virtualizadas con `role="option"`, `onKeyDown`, `activate`) y `CommentsPanel.module.css`; `src/ui/messages-comments.ts` (PDF-109).
- Tests: `tests/unit/annotations/comment-list.test.ts`, `tests/ui/comments-panel.test.tsx`, `tests/e2e/comments-panel.spec.ts`.

## Qué hay que hacer
1. `comment-list.ts`:
   - `CommentRow` de tipo `item` gana `state: ReviewState | null` y `replyCount: number`. Nuevo tipo de fila `{ kind: 'reply'; id; parentId; pageIndex; author; modified; excerpt }` justo debajo de su comentario, en el orden de `repliesOf` (las respuestas de respuestas también, tras su padre, sin más sangría).
   - `REPLY_ROW_HEIGHT = 52`; `rowLayout` lo usa. El recuento de la cabecera de página sigue contando solo comentarios (no respuestas).
   - `CommentFilter` gana `states: ReadonlySet<ReviewState | 'none'>` (vacío = todos); `EMPTY_COMMENT_FILTER` lo incluye. El filtro de texto también busca en el texto de las respuestas (si coincide una respuesta, se muestra el comentario con todas sus respuestas).
   - `nextItemRow` salta también por filas `reply` (son seleccionables y activables).
2. `CommentsPanel.tsx`: fila `reply` sangrada 24 px con autor, fecha y extracto; activarla (clic, Intro) abre la ventana del comentario padre. En la fila del comentario, una etiqueta con el estado (si lo hay) y «N respuestas». Menú de filtro: grupo nuevo «Estado» con las cinco opciones + «Sin estado».
3. Tests en los tres ficheros de «Contexto».

## Criterios de aceptación
- [ ] Unit: una nota con 2 respuestas y estado `Rejected` → filas `[page, item(state 'Rejected', replyCount 2), reply, reply]`; la cabecera de página cuenta 1.
- [ ] Unit: filtro de estado `{'Accepted'}` oculta la nota anterior; `{'none'}` muestra las que no tienen estado; texto que solo aparece en una respuesta muestra el comentario y sus respuestas.
- [ ] UI: flecha abajo desde el comentario pasa a su primera respuesta; Intro en una respuesta abre la ventana del comentario padre.
- [ ] Rendimiento: `comment-list.perf.test.ts` con 5 000 comentarios y 5 000 respuestas no supera el presupuesto actual ×1,5.
- [ ] E2E: tras responder y marcar «Aceptado» (como en PDF-109), el panel muestra la respuesta sangrada y «Aceptado»; filtrar por «Rechazado» la oculta.
- [ ] axe sin violaciones nuevas en el panel (`tests/e2e/annotations-a11y.spec.ts`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm perf`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Responder desde el propio panel (se hace en la ventana del comentario). Ordenar por fecha o autor.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
