---
tipo: tarea
id: PDF-116
titulo: Respuestas y estados en el panel de comentarios
app: pdf
estado: hecha
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

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/comment-list.ts`, `apps/lector-pdf/src/core/annotations/replies.ts` (`indexReplies`, `threadRootId`), `apps/lector-pdf/src/ui/sidebar/CommentsPanel.tsx` y `.module.css`, `apps/lector-pdf/src/ui/kit/MenuButton.tsx` y `.module.css` (rótulo de grupo `heading`), `apps/lector-pdf/src/ui/messages-comments.ts`; tests en `tests/unit/annotations/comment-list.test.ts`, `tests/perf/comment-list.perf.test.ts`, `tests/ui/comments-panel.test.tsx`, `tests/e2e/comments-panel.spec.ts`, `tests/e2e/annotations-a11y.spec.ts`.
- Qué he hecho: filas `reply` sangradas bajo su comentario (`REPLY_ROW_HEIGHT` 52), `state` y `replyCount` en las filas `item`, `CommentFilter.states` con grupo «Estado» en el menú Filtrar, búsqueda de texto también en respuestas y navegación con flechas, Intro y clic en respuestas. El índice de respuestas y estados es de un solo recorrido para no ser cuadrático.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK (un error previo en `new-document.test.ts`, ajeno a esta ficha, ya no aparece); `pnpm coverage` (con directorio propio) 255 ficheros y 3 229 tests OK, `comment-list.ts` 100 % líneas, `replies.ts` 100 %; `pnpm perf` 40/40 OK (nuevo caso 5 000 comentarios + 5 000 respuestas bajo 150 ms); e2e de `comments-panel`, `annotations-a11y` y `replies` OK; `pnpm --filter lector-pdf e2e` completo: 254 OK y 4 fallos (`annotations-flow.spec.ts:94`, `annotations-foreign.spec.ts:72`, `notes.spec.ts:91`, `outline.spec.ts:64`). Los cuatro fallan igual en una copia de `HEAD` sin mis cambios, así que son previos y no los he tocado. Por eso el e2e completo no sale con código 0.
- Dudas o cosas que no he podido hacer:
  - «Cinco opciones» de estado: he puesto las cuatro con nombre (Aceptado, Rechazado, Cancelado, Completado) más «Sin estado»; «Ninguno» equivale a «Sin estado» y no lo duplico.
  - Una respuesta de respuesta, al activarla, abre la ventana del comentario raíz del hilo. `replyCount` cuenta todas las respuestas del hilo, de todos los niveles.
  - El filtro de autor solo afecta a los comentarios, no a las respuestas. Supr sobre una fila de respuesta no borra nada (el borrado sigue en la ventana del comentario).
  - Pido revisar si el e2e de los cuatro tests previos debe abrirse como incidencia aparte.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. Verificado: lint y typecheck OK. Los 4 E2E (annotations-flow:94, annotations-foreign:72, notes:91, outline:64) fallan en HEAD y también en una copia de `HEAD~1` sin los cambios (annotations-foreign:72 pasó una vez en la copia, pero falló en 2 repeticiones posteriores: intermitente, en `openCommentsPanel`/pestaña «Comentarios» no encontrada). Son previos; no atribuibles a PDF-116.
2. Recomendación al líder: abrir una ficha aparte para estos 4 E2E; el criterio «e2e con código 0» queda condicionado a ella.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Unit filas/filtros, UI flechas e Intro | OK | `pnpm coverage`: todo verde, 97,73 % líneas |
| Rendimiento 5 000+5 000 | OK | `pnpm perf` 40/40 |
| E2E panel y respuestas/Aceptado/filtro Rechazado | OK | `comments-panel.spec.ts` 8/8 junto a a11y |
| axe sin violaciones nuevas | OK | `annotations-a11y.spec.ts` (incl. caso PDF-116) |
| lint, typecheck | OK | código 0 |
| e2e completo código 0 | NO (previo) | 5 fallos: `annotations-flow:94`, `annotations-foreign:72`, `notes:91` (reproducible, previo), y dos de tiempo bajo carga (`performance:72`, `render:70`) que pasan aislados. Ninguno toca el panel. |
Pendiente para el líder: ficha aparte para los E2E inestables/previos (notes:91, annotations-flow:94, annotations-foreign:72, outline:64).
