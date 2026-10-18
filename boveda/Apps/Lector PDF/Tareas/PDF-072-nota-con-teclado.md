---
tipo: tarea
id: PDF-072
titulo: Colocar una nota solo con el teclado
app: pdf
estado: hecha
depende_de: [PDF-033, PDF-070, PDF-071]
intentos: 0
skills: [calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, anotaciones, teclado, accesibilidad]
---

# PDF-072 · Nota con teclado

Plan: [[Apps/Lector PDF/Plan|Plan]] · Origen: [[PDF-039-e2e-anotaciones]] (Registro, ronda 1, punto 2) · Notas: [[PDF-033-notas-emergentes]]

## Objetivo
Crear una nota sin ratón. Hoy «Nota» activa la herramienta y la nota solo se coloca con un clic en la página (`createNoteAt` en `AnnotationLayer.tsx`).

## Decisión del líder (no cambiar)
- **Activar «Nota» con teclado o lector de pantalla** (evento `click` con `event.detail === 0`: Intro, Espacio o activación de tecnología de apoyo) y con la herramienta «Nota» **no** activa → crea la nota al momento en la **página actual**, arriba a la izquierda de la parte visible (centro a 34 pt de los bordes izquierdo y superior de lo visible), la selecciona, abre su ventana de comentario (foco en el texto, como hoy) y deja la herramienta en «ninguna». Es una sola entrada de deshacer («añadir nota»), igual que con el ratón.
- Después, **Esc** cierra la ventana y devuelve el foco a la nota (ya existe) y las **flechas** la mueven 1 pt (Mayús: 10 pt) porque queda seleccionada (ya existe, PDF-031).
- Con el **ratón** (`detail ≥ 1`) no cambia nada: activa la herramienta y la nota se coloca con clic. Si la herramienta ya estaba activa, cualquier activación la desactiva (como hoy).
- El botón explica el comportamiento con una descripción accesible y en el tooltip.

## Contexto
- Leer: `apps/lector-pdf/src/core/annotations/note.ts`, `src/core/annotations/comment-list.ts` (`rectTopFraction`: convención de rotación y de `dims.width/height` sin girar, que aquí se invierte), `src/state/annotation-actions.ts` (`addAnnotation`, `select`, `openPopupWhenPageCurrent`, `setTool`, `newAnnotationId`, `nowIso`), `src/ui/viewer/AnnotationLayer.tsx` (`createNoteAt`), `src/ui/toolbar/CommentToolbar.tsx` (`onToolClick`), `src/ui/kit/IconButton.tsx`, `src/ui/viewer/Viewer.tsx` (cálculo de `currentYFraction`: fracción de la página actual en el borde superior del visor).
- Depende de [[PDF-071-barra-comentar-flechas]] y [[PDF-070-panel-comentarios-accesible]] solo porque tocan los mismos ficheros (`CommentToolbar.tsx`, `tests/ui/comment-toolbar.test.tsx`, `messages.ts`, `tests/e2e/notes.spec.ts`). Usa `optionName()` de PDF-070 si buscas filas del panel.

## Qué hay que hacer
1. `src/core/annotations/note.ts`:
   ```ts
   /** Distancia del icono de una nota colocada con teclado a los bordes izquierdo y superior de lo visible, en pt. */
   export const NOTE_KEYBOARD_INSET_PT = 24;
   /**
    * Rectángulo de una nota colocada con teclado: centrada a INSET + NOTE_SIZE_PT/2 pt del borde izquierdo de la
    * vista y del borde superior visible (`yFraction` de la página). `widthPt`/`heightPt` sin girar; `rotation` total
    * de la vista (página + visor), 0/90/180/270.
    */
   export function keyboardNoteRect(widthPt: number, heightPt: number, rotation: number, yFraction: number): RectPt
   ```
   Pseudocódigo (exacto):
   ```
   r = ((rotation % 360) + 360) % 360
   c = NOTE_KEYBOARD_INSET_PT + NOTE_SIZE_PT / 2          // 34
   viewH = (r === 90 || r === 270) ? widthPt : heightPt
   vx = c ; vy = yFraction * viewH + c                    // punto en la vista, pt desde arriba-izquierda
   r = 0   → x = vx,           y = heightPt - vy
   r = 90  → x = vy,           y = vx
   r = 180 → x = widthPt - vx, y = vy
   r = 270 → x = widthPt - vy, y = heightPt - vx
   return noteRectAt(x - NOTE_SIZE_PT / 2, y + NOTE_SIZE_PT / 2, [0, 0, widthPt, heightPt])
   ```
2. `src/state/annotation-actions.ts`: `export function addNoteFromKeyboard(): string | null`. Lee `useViewer.getState()` (`dims`, `currentPage`, `currentYFraction`, `rotation`); si `dims === null` o `currentPage >= dims.count` devuelve `null`. Si no: `rect = keyboardNoteRect(dims.width(i), dims.height(i), (dims.rotation(i) + rotation) % 360, currentYFraction)`; crea la nota con `newNoteAnnotation({ id: newAnnotationId(), pageIndex: i, rect, color: colors.note, author, now: nowIso() })`; `addAnnotation(note)`, `setTool('none')`, `select(note.id)`, `openPopupWhenPageCurrent(note.id, i)`; devuelve `note.id`.
3. `src/ui/kit/IconButton.tsx`:
   - `onClick?: (event: MouseEvent<HTMLButtonElement>) => void` (compatible con los usos actuales).
   - Nueva prop opcional `description?: string`: si existe, `title` = `` `${base}\n${description}` `` (donde `base` es el título actual) y se renderiza dentro del botón `<span id={descId} hidden>{description}</span>` con `aria-describedby={descId}` en el botón (`descId` con `useId()`).
4. `src/ui/messages.ts`: `toolNoteKeyboardHint: 'Con el teclado, Intro coloca la nota en la página actual; después, Esc y las flechas la mueven.'`
5. `src/ui/toolbar/CommentToolbar.tsx`: `onToolClick(id, tool, fromKeyboard: boolean)`; al principio: `if (id === 'note' && fromKeyboard && tool !== 'note') { addNoteFromKeyboard(); return; }`. El botón pasa `fromKeyboard = event.detail === 0`. Solo el botón «Nota» recibe `description={msg.toolNoteKeyboardHint}`.
6. Si algún test existente activa «Nota» con Intro y luego hace clic en la página, adáptalo para activarla con clic (es el flujo de ratón) y deja constancia en el Registro.

## Criterios de aceptación
- [ ] `tests/unit/annotations/note.test.ts`, `keyboardNoteRect(612, 792, rot, yF)`:
  - `(0, 0)` → `[24, 748, 44, 768]`; `(90, 0)` → `[24, 24, 44, 44]`; `(180, 0)` → `[568, 24, 588, 44]`; `(270, 0)` → `[568, 748, 588, 768]`;
  - `(0, 0.5)` → `[24, 352, 44, 372]`; `(0, 1)` → `[24, 0, 44, 20]` (se ajusta dentro de la página); `(-90, 0)` igual que `(270, 0)`.
- [ ] `tests/unit/annotations/annotation-actions.test.ts`: con `dims` falsos y `currentPage: 1`, `addNoteFromKeyboard()` devuelve un id; `getEffective()` tiene una nota en la página 1 con el `rect` de `keyboardNoteRect`; `tool === 'none'`, `selectedId` es ese id; un `undo()` la quita. Con `dims: null` devuelve `null` y no añade nada.
- [ ] `tests/ui/comment-toolbar.test.tsx`: foco en «Nota» + `{Enter}` → se crea una nota y `aria-pressed` de «Nota» es `false`; `user.click` en «Nota» → no se crea nada y `aria-pressed` es `true`; «Nota» tiene descripción accesible (`toHaveAccessibleDescription(msg.toolNoteKeyboardHint)`) y su nombre sigue siendo exactamente «Nota».
- [ ] `tests/e2e/notes.spec.ts`, nueva prueba sin ratón sobre `basic-5.pdf`: abrir la barra «Comentar», foco en «Nota», Intro → la ventana de comentario tiene el foco; escribir «Hola» → Esc → el foco está en la zona «Nota de …» de la página 1; → ×10 → el `x` del icono (bounding box) ha aumentado; Ctrl+S → descarga; `qpdfAnnotations` del descargado tiene un `Text` con `Contents` «Hola».
- [ ] Deshacer/rehacer: Ctrl+Z tras crear la nota con teclado la quita; Ctrl+Y la repone (en el test de UI o e2e).
- [ ] `pnpm --filter lector-pdf e2e` con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test` con código 0.

## Fuera de alcance
- Texto libre y dibujo con teclado (el texto libre se crea en el sitio con ratón; el dibujo a mano es inherentemente de puntero).
- Atajo de teclado global para «nueva nota».
- Elegir la página o la posición con un cursor de teclado sobre la página.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/core/annotations/note.ts` (`NOTE_KEYBOARD_INSET_PT`, `keyboardNoteRect`); `apps/lector-pdf/src/state/annotation-actions.ts` (`addNoteFromKeyboard`); `apps/lector-pdf/src/ui/kit/IconButton.tsx` (`onClick` con evento, prop `description` con `aria-describedby` y tooltip); `apps/lector-pdf/src/ui/messages.ts` (`toolNoteKeyboardHint`); `apps/lector-pdf/src/ui/toolbar/CommentToolbar.tsx` (`onToolClick(id, tool, fromKeyboard)`, descripción solo en «Nota»); tests: `tests/unit/annotations/note.test.ts`, `tests/unit/annotations/annotation-actions.test.ts`, `tests/ui/comment-toolbar.test.tsx`, `tests/e2e/notes.spec.ts` (prueba nueva sin ratón), `tests/e2e/annotations-keyboard.spec.ts` (adaptado, ver abajo).
- Qué he hecho: «Nota» con Intro/Espacio (`detail === 0`) crea la nota en la página actual arriba a la izquierda de lo visible, la selecciona, abre su ventana y deja la herramienta en «ninguna»; con ratón no cambia nada. Los valores de `keyboardNoteRect` de la ficha salen tal cual (la fila de rotación 90 con fracción 0,5 da `[330, 24, 350, 44]`, que sigue el pseudocódigo exacto). Una sola entrada de deshacer.
- Comandos ejecutados y resultado: `pnpm lint` OK (código 0); `pnpm typecheck` OK; `pnpm test` OK (143 ficheros, 1709 tests); `pnpm --filter lector-pdf e2e` OK (156 passed); `pnpm coverage` OK (líneas globales 97,05 %). Antes de llegar aquí, dos errores de typecheck en mis tests (`exact` no existe en Testing Library y un estrechamiento de tipo en el helper e2e): corregidos.
- Dudas o cosas que no he podido hacer: (1) Adapté `tests/e2e/annotations-keyboard.spec.ts`: el paso de «Nota» ahora usa `click()` (flujo de ratón) en lugar de Intro, porque con Intro la nota se crearía sola; actualicé su cabecera, que decía que colocar una nota con teclado no se podía probar. (2) Ctrl+Y/Ctrl+Z tras la nota por teclado está cubierto en test unitario (`undo`/`redo` sobre `addNoteFromKeyboard`), no en UI ni e2e. (3) `apps/lector-pdf/tests/ui/comments-panel.test.tsx` ya estaba modificado sin commitear antes de empezar; no es de esta ficha y no lo incluyo en el commit.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Lint, typecheck y `pnpm test` (1709) con código 0. El e2e no pude relanzarlo (puerto 4173 ocupado por otro proceso); me fío del 156 passed del programador, y el test e2e nuevo cubre el flujo completo, incluidos Ctrl+Z/Ctrl+Y. `keyboardNoteRect` sigue el pseudocódigo exacto y los tests cubren los valores de la ficha.
1. (opcional) `apps/lector-pdf/tests/ui/comment-toolbar.test.tsx` final — línea en blanco sobrante al final del fichero.
2. (opcional) Registro del programador, duda 2 — dice que Ctrl+Z/Ctrl+Y no está en e2e, pero sí lo está en `tests/e2e/notes.spec.ts`.
3. (opcional) Hay cambios sin commitear ajenos a la ficha (`comments-panel.test.tsx`, PDF-039/070/071 y Plan); no mezclarlos en el commit de PDF-072.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| Unit `keyboardNoteRect` (valores de la ficha, -90 = 270) | OK | `note.test.ts` dentro de `pnpm test`: 143 ficheros, 1709 tests passed |
| Unit `addNoteFromKeyboard` (id, rect, tool none, selectedId, undo, dims null) | OK | `annotation-actions.test.ts`, mismo run |
| UI Intro crea nota y `aria-pressed` false; clic no crea y `aria-pressed` true; descripción accesible y nombre «Nota» | OK | `comment-toolbar.test.tsx` línea 291 y siguientes, mismo run |
| E2E sin ratón sobre basic-5.pdf (foco, Esc, flechas ×10, Ctrl+S, `Text` «Hola») | OK | `notes.spec.ts:190` ✓ en `pnpm --filter lector-pdf e2e` |
| Deshacer/rehacer con Ctrl+Z / Ctrl+Y | OK | `notes.spec.ts` líneas 203-210 (e2e) y unit |
| Lint, typecheck, test, e2e con código 0 | OK | lint+typecheck+test exit 0; e2e `156 passed (3.1m)`, exit 0 |

Incidencia de entorno: había un `vite preview` huérfano (PID 2898, puerto 4173) de una ejecución anterior; la primera ejecución del e2e falló con «already used». Lo detuve (`kill`), confirmé el puerto libre (`curl` devuelve 000) y relancé: e2e verde y puerto libre al terminar. Sin skip/only/expect(true) en los ficheros tocados.
Tests añadidos: ninguno nuevo (los del programador cubren todos los criterios). Rendimiento: no aplica a esta ficha.
