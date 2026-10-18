---
tipo: tarea
id: PDF-071
titulo: Las flechas, Inicio y Fin de la barra «Comentar» no deben cambiar de página
app: pdf
estado: hecha
depende_de: [PDF-069]
intentos: 0
skills: []
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, anotaciones, teclado, bug]
---

# PDF-071 · Teclas de la barra «Comentar» sin efecto en la página

Plan: [[Apps/Lector PDF/Plan|Plan]] · Origen: [[PDF-039-e2e-anotaciones]] (Registro, ronda 1, punto 3) · Barra: [[PDF-069-barra-comentar]]

## Objetivo
Con el foco en un control de la barra «Comentar», → ← Inicio Fin solo mueven el foco itinerante; no cambian de página (hoy además disparan los atajos globales `next-page`, `prev-page`, `first-page`, `last-page`).

## Causa (ya analizada)
`CommentToolbar.onKeyDown` llama a `preventDefault()` pero no a `stopPropagation()`; el atajo global (`src/ui/use-shortcuts.ts`, escucha en `window`) recibe la tecla. `CommentsPanel`, `OutlinePanel` y `Sidebar` ya hacen `stopPropagation()` en el mismo caso.

## Contexto
- Leer: `apps/lector-pdf/src/ui/toolbar/CommentToolbar.tsx` (`onKeyDown`), `src/ui/use-shortcuts.ts`, `tests/ui/comment-toolbar.test.tsx` (bloque «barra «Comentar» · teclado» y su `openCommentBar`).

## Qué hay que hacer
1. **Primero el test rojo**, en `tests/ui/comment-toolbar.test.tsx`, bloque «barra «Comentar» · teclado»: `it('→ ← Inicio Fin en la barra no cambian de página', …)`. Prepara el visor con varias páginas y la página actual en medio: `useViewer.setState({ currentPage: 2 })` tras abrir la barra (si `next-page` necesita `dims` para avanzar, usa el mismo montaje con documento que ya use otro test del fichero o de `tests/ui/page-navigator.test.tsx`). Foco en «Resaltar»; pulsa `{ArrowRight}`, `{ArrowLeft}`, `{End}`, `{Home}` comprobando tras cada una que `useViewer.getState().currentPage` sigue en 2 y que el foco se ha movido como hoy. Además, un `window.addEventListener('keydown', spy)` registrado antes de pulsar no debe recibir ninguna de las cuatro teclas.
2. Ejecuta el test y **anota en el Registro que falla** (salida resumida) antes de tocar el código.
3. `CommentToolbar.tsx`, en `onKeyDown`, tras el `switch` (solo para las teclas tratadas): `event.preventDefault(); event.stopPropagation();`. Actualiza el comentario de la función.
4. Añade a `tests/e2e/comment-toolbar-qa.spec.ts` una prueba: `basic-5.pdf`, abrir la barra, foco en «Resaltar», pulsar → dos veces → el foco está en «Tachar» y el indicador de página sigue en 1.

## Criterios de aceptación
- [ ] El Registro muestra el test del paso 1 en rojo antes del arreglo y en verde después.
- [ ] Fuera de la barra (foco en el visor), → sigue pasando de página: el test existente de `next-page` sigue en verde.
- [ ] `pnpm --filter lector-pdf exec playwright test comment-toolbar-qa` en verde.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Las teclas dentro de un menú abierto de la barra (ya las trata `MenuButton`).
- Panel de comentarios ([[PDF-070-panel-comentarios-accesible]]) y nota con teclado ([[PDF-072-nota-con-teclado]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/toolbar/CommentToolbar.tsx`, `apps/lector-pdf/tests/ui/comment-toolbar.test.tsx`, `apps/lector-pdf/tests/e2e/comment-toolbar-qa.spec.ts`, esta ficha.
- Qué he hecho: añadido el test `→ ← Inicio Fin en la barra no cambian de página y no llegan a los atajos globales` (documento de 10 páginas en la 3.ª, foco en «Resaltar», comprobaciones de `currentPage`, `navRequest` y de un listener de `window`). Antes del arreglo falló en `navRequest` (ArrowRight pedía la página 3, `next-page` global). Arreglo: `event.stopPropagation()` en `onKeyDown` de la barra, tras el `preventDefault()`, solo para las teclas tratadas; comentario de la función actualizado. Nuevo caso e2e en `comment-toolbar-qa.spec.ts` (basic-5.pdf, → → desde «Resaltar» lleva a «Tachar» y el campo de página sigue en 1).
- Comandos ejecutados y resultado:
  - `vitest run tests/ui/comment-toolbar.test.tsx`: rojo antes del arreglo (1 fallo, el nuevo); tras el arreglo, 11/11 verde.
  - `playwright test comment-toolbar-qa`: 2/2 verde.
  - `pnpm lint`: código 0. `pnpm typecheck`: código 0.
  - `pnpm test` (raíz): 143 ficheros, 1693 tests verde (en una pasada intermedia fallaban 2 tests de `comments-panel.test.tsx`, trabajo en curso de PDF-070, no relacionado; en la pasada final ya pasan).
- Dudas o cosas que no he podido hacer: ninguna. No he tocado los ficheros de PDF-070 ni he hecho `git add -A`; el commit incluye solo los ficheros de esta ficha.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Lint, typecheck, `tests/ui` (265) y e2e `comment-toolbar-qa` (2/2) en verde. El arreglo es mínimo y solo afecta a las teclas tratadas; el test comprueba foco, `currentPage`, `navRequest` y un listener de `window`. Sin problemas bloqueantes.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Test rojo antes / verde después | OK | Quitando `stopPropagation()` (mutación temporal, revertida) el test nuevo falla (1 failed, 10 passed); con el arreglo 11/11 |
| Fuera de la barra, → sigue paginando | OK | `page-navigator.test.tsx` y `tests/unit` en verde (84 ficheros, 1140 tests) |
| e2e `comment-toolbar-qa` | OK | 2/2 en Chromium |
| lint, typecheck, test | OK | código 0; 143 ficheros, 1693 tests verde (con el trabajo sin commitear de PDF-070 en el árbol, sin fallos) |
Tests añadidos: ninguno (los existentes cubren los criterios). Rendimiento: no aplica.
