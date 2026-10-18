---
tipo: tarea
id: PDF-069
titulo: Barra «Comentar» y botones de deshacer/rehacer en la barra principal
app: pdf
estado: hecha
depende_de: [PDF-030, PDF-011, PDF-020]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, anotaciones]
---

# PDF-069 · Barra «Comentar» y botones de deshacer/rehacer

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]] · [[ADR-0005-modelo-deshacer-rehacer]] · Origen: parte de UI de [[PDF-030-estado-de-anotaciones]]

## Objetivo
La barra principal tiene «Deshacer», «Rehacer» y el conmutador «Comentar»; este abre una segunda fila con las herramientas (Resaltar, Subrayar, Tachar, Nota, Texto, Dibujar), el color, el grosor y el tamaño de letra, usable entera con teclado. Las fichas PDF-032 a PDF-035 conectan después cada herramienta.

## Contexto
- Leer: `src/state/annotation-store.ts`, `src/state/annotation-actions.ts` (PDF-030: `setTool`, `setToolColor`, `setInkWidth`, `setFontSize`, `setCommentBarOpen`, `undo`, `redo`), `src/core/annotations/palette.ts` (`PALETTE`, `INK_WIDTHS`, `FONT_SIZES`), `src/ui/App.tsx` (botones provisionales de deshacer/rehacer), `src/ui/toolbar/MainToolbar.tsx` (PDF-011), `src/ui/kit/IconButton.tsx`, `src/ui/kit/MenuButton.tsx` (PDF-020), `src/ui/icons.tsx`, `src/ui/messages.ts`, `src/ui/shortcuts.ts` (`formatShortcut`).
- La barra «Comentar» no tiene atajo (`Mod+Shift+C` lo usa el navegador).
- El estado ya existe: aquí no se toca `annotation-actions.ts` ni `annotation-store.ts`.

## Qué hay que hacer
1. `IconButton` y `MenuButton`: añade props opcionales `tabIndex?: number` y `ref?: Ref<HTMLButtonElement>` (React 19: `ref` como prop normal), que se pasan al `<button>`. Sin cambios de comportamiento si no se usan.
2. Mueve los botones «Deshacer» y «Rehacer» de la cabecera de `App.tsx` a `MainToolbar`, en un grupo propio tras el de Abrir (separador `role="separator"`), con la misma lógica (`label` con `msg.undoWith(undoLabel)`, `shortcut` con `formatShortcut`, `disabled` según `canUndo`/`canRedo`). Solo habilitados con documento abierto.
3. En `MainToolbar`, botón conmutador «Comentar» (`IconComment`, nuevo en `icons.tsx`): `pressed={commentBarOpen}`, `onClick={() => setCommentBarOpen(!commentBarOpen)}`. Al cerrarse la barra → `setTool('none')`.
4. `src/ui/toolbar/CommentToolbar.tsx` (+ `CommentToolbar.module.css`), montada en `App.tsx` bajo `MainToolbar` solo si `status === 'ready' && commentBarOpen`:
   - `<div role="toolbar" aria-label={msg.commentToolbar} aria-orientation="horizontal">`.
   - 6 `IconButton` con `pressed={tool === t}`; clic → `setTool(tool === t ? 'none' : t)`. Etiquetas: «Resaltar», «Subrayar», «Tachar», «Nota», «Texto», «Dibujar». Iconos nuevos en `icons.tsx`: `IconHighlight`, `IconUnderline`, `IconStrikeout`, `IconNote`, `IconFreeText`, `IconInk` (SVG 20×20, `currentColor`, `aria-hidden`).
   - `MenuButton` «Color» (siempre visible; deshabilitado con `tool === 'none'`): un `menuitemradio` por entrada de `PALETTE` con una muestra de color (`<span>` 12×12 con `background: rgb(...)`, `aria-hidden`) y el `label`; `aria-checked` si coincide con `colors[tool]`; elegir → `setToolColor(tool, rgb)`.
   - `MenuButton` «Grosor» solo si `tool === 'ink'`: `INK_WIDTHS` como «1 pt», «2 pt», «4 pt», «8 pt»; → `setInkWidth`.
   - `MenuButton` «Tamaño de letra» solo si `tool === 'freetext'`: `FONT_SIZES` como «N pt»; → `setFontSize`.
   - Patrón *toolbar* con `tabindex` itinerante: estado local `activeIndex`; la lista de controles se calcula en el render (los visibles y habilitados, en orden); el de `activeIndex` lleva `tabIndex={0}` y el resto `-1`; `onKeyDown` del contenedor: → / ← (circular), Inicio, Fin mueven `activeIndex` y el foco (`refs[i].focus()`). Si el control activo desaparece (p. ej. se oculta «Grosor»), `activeIndex` se ajusta al último existente (`Math.min`).
5. Mensajes en `messages.ts`: `commentToggle` «Comentar», `commentToolbar` «Comentar», `toolHighlight` … `toolInk`, `color` «Color», `inkWidth` «Grosor», `fontSize` «Tamaño de letra», `pointSize: (n: number) => \`${n} pt\``.
6. Tests: `tests/ui/comment-toolbar.test.tsx` y ajusta los de `App` que buscaban los botones en la cabecera.

## Criterios de aceptación
- [x] (T) Pulsar «Comentar» muestra la barra (`getByRole('toolbar', { name: 'Comentar' })`) y `aria-pressed="true"`; pulsarlo otra vez la oculta y deja `tool === 'none'`.
- [x] (T) Clic en «Dibujar» → `aria-pressed="true"` solo en «Dibujar» y existe el menú «Grosor»; clic otra vez → `tool === 'none'` y «Grosor» no existe. «Tamaño de letra» solo existe con «Texto».
- [x] (T) Con el foco en «Resaltar», → lo lleva a «Subrayar», Fin al último control, Inicio al primero, ← desde el primero al último; solo un control de la barra tiene `tabindex="0"`.
- [x] (T) Con «Resaltar» activo, menú «Color» → «Verde» → `colors.highlight` es `[0.4, 0.73, 0.42]` y el elemento «Verde» tiene `aria-checked="true"`.
- [x] (T) «Deshacer» en `MainToolbar`: deshabilitado sin cambios; tras `addAnnotations('añadir resaltado', [a])` habilitado con `title` «Deshacer añadir resaltado (Ctrl+Z)» y al pulsarlo llama a `undo`.
- [x] Todos los botones de icono tienen `aria-label` y tooltip; se ven bien en tema claro y oscuro (variables CSS del tema, sin colores fijos salvo las muestras de la paleta).
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Lo que hace cada herramienta sobre la página (PDF-032 a PDF-035), cursor y capa (PDF-031). Cambiar el color de una anotación seleccionada (PDF-034, PDF-035). Guardar (PDF-037).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/icons.tsx`, `src/ui/kit/IconButton.tsx`, `src/ui/kit/MenuButton.tsx`, `src/ui/kit/MenuButton.module.css`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/App.tsx`, `src/ui/messages.ts`, `src/core/annotations/palette.ts` (etiquetas con mayúscula); nuevos: `src/ui/toolbar/CommentToolbar.tsx`, `src/ui/toolbar/CommentToolbar.module.css`, `tests/ui/comment-toolbar.test.tsx`, `tests/ui/main-toolbar.test.tsx`.
- Qué he hecho: `IconButton` y `MenuButton` aceptan `tabIndex` y `ref` (y `MenuButton`, `disabled`; las entradas de menú admiten `swatch`). `MainToolbar` tiene el conmutador «Comentar» (`pressed` según `commentBarOpen`; al cerrar, `setTool('none')`) y «Deshacer»/«Rehacer» con `!ready ||` en `disabled`. `CommentToolbar` (montada en `App` solo con `status === 'ready' && commentBarOpen`) con las 6 herramientas, «Color», «Grosor» (solo con «Dibujar») y «Tamaño de letra» (solo con «Texto»), y foco itinerante (→, ←, Inicio, Fin; el control activo se ajusta con `Math.min` si desaparece).
- Comandos ejecutados y resultado: `pnpm lint` OK (código 0); `pnpm typecheck` OK; `pnpm test` OK (131 ficheros, 1541 tests); `pnpm coverage` OK (código 0). No hay commit, según la instrucción.
- Dudas o cosas que no he podido hacer:
  - El paso 2 describe botones «provisionales» en la cabecera de `App.tsx`, pero no existían: «Deshacer»/«Rehacer» ya estaban en `MainToolbar`. Solo añadí `!ready ||` a su `disabled` y dejé su posición (tras Abrir/Guardar/Guardar como).
  - Añadido para cumplir la ficha: `disabled` y `swatch` en `MenuButton`; tres iconos para los menús (`IconColor`, `IconInkWidth`, `IconFontSize`); etiquetas de `PALETTE` con mayúscula («Verde», como pide el criterio).
  - Los tests de deshacer están en `tests/ui/main-toolbar.test.tsx` (nuevo) en vez de en `comment-toolbar.test.tsx`. El conmutador «Comentar» se deshabilita sin documento abierto (como el resto de la barra).
  - `apps/lector-pdf/playwright.config.ts` aparece modificado en el árbol; es del otro programador (PDF-022), no lo he tocado.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- `pnpm lint` (raíz, 0 avisos), `pnpm typecheck` y `pnpm test` (raíz, 1541 tests) en verde. Los 5 criterios (T) tienen test que falla si dejan de cumplirse; CSS solo con variables del tema; `aria-label` y tooltip en todos los botones.
- Las desviaciones del programador (Deshacer/Rehacer ya estaban en `MainToolbar`; `disabled`/`swatch` en `MenuButton`; etiquetas de `PALETTE` con mayúscula) son razonables y no rompen nada.
- (opcional) `CommentToolbar.tsx`: al cerrar «Comentar» con el foco dentro de la barra, el foco se pierde; devolverlo al conmutador.
- Nota para el tester: `pnpm test` dentro de `apps/lector-pdf` falla con "Missing script" (solo funciona desde la raíz o con `npx vitest run`); ajeno a esta ficha.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Conmutador Comentar | OK | `tests/ui/comment-toolbar.test.tsx` + E2E nuevo (aria-pressed, barra aparece/desaparece) |
| Dibujar / Grosor / Tamaño de letra | OK | test UI y E2E (Grosor visible con Dibujar, ausente Tamaño de letra) |
| Teclado (→ ← Inicio Fin, tabindex itinerante) | OK | test UI + E2E en Chromium |
| Color Verde (`[0.4,0.73,0.42]`, aria-checked) | OK | test UI + E2E (aria-checked true) |
| Deshacer en MainToolbar | OK | `tests/ui/main-toolbar.test.tsx`; E2E: deshabilitado sin cambios |
| aria-label/tooltip, tema | OK | CSS solo con `var(--color-*)`; revisado |
| lint/typecheck/test/coverage/build | OK | lint 0 avisos; typecheck OK; 131 ficheros, 1541 tests; cobertura líneas 98,9 %; build web OK |

Tests añadidos: `apps/lector-pdf/tests/e2e/comment-toolbar-qa.spec.ts` (pasa con `LECTOR_E2E_PORT=4391 pnpm exec playwright test comment-toolbar-qa`).
Rendimiento: no aplica a esta ficha. Observación menor (ya anotada por el revisor): al cerrar «Comentar» con el foco en la barra, el foco se pierde.
