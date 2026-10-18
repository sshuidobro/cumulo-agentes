---
tipo: tarea
id: PDF-033
titulo: Notas emergentes y comentarios sobre resaltados
app: pdf
estado: pendiente
depende_de: [PDF-031, PDF-069]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, anotaciones, accesibilidad]
---

# PDF-033 · Notas emergentes

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0009-anotaciones-escritor-incremental]]

## Objetivo
Con la herramienta «Nota», un clic en la página coloca un icono de nota y abre su ventana emergente para escribir. Cualquier anotación (también un resaltado, subrayado, tachado o dibujo) muestra su ventana emergente con doble clic o Intro, donde se lee y edita el comentario, con autor y fecha. Escribir se deshace por bloques, como en un procesador de texto.

## Contexto
- Leer: `src/ui/viewer/AnnotationLayer.tsx` (PDF-031), `src/state/annotation-actions.ts`, `src/core/annotations/commands.ts` (`mergeKey`), `src/ui/kit/IconButton.tsx`.
- La ventana emergente es HTML nuestro (no un `/Popup` de pdf.js). Las notas del fichero sin tocar también la abren (al editar pasan a «modificadas»).
- Fechas: `new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' })`.

## Qué hay que hacer
1. Herramienta `note`: clic en la página (capa de anotaciones captura el puntero) → nota nueva con `rect` 20×20 cuya esquina superior izquierda es el punto del clic (en pt; limitada al tamaño de la página), `icon 'Comment'`, `open false`, color de la herramienta, `contents ''` → `addAnnotation` (etiqueta «añadir nota»), selecciona y abre su ventana. Después la herramienta vuelve a `'none'` (como Acrobat).
2. `src/state/annotation-store.ts`: `openPopupId: string | null`; acciones `openPopup(id)`, `closePopup()`.
3. `src/ui/viewer/AnnotationPopup.tsx` (dentro de `PageView`, posicionado junto al `rect` de la anotación, a la derecha si cabe, si no a la izquierda; nunca fuera de la página visible): `role="dialog"` **no modal** con `aria-label` «Comentario de <autor>»; cabecera con autor, fecha (`modified`) y botones «Borrar» (`IconTrash`) y «Cerrar» (`IconClose`); `textarea` con `aria-label` «Comentario» que recibe el foco al abrir.
   - Escribir → `updateAnnotation({ ...a, contents, modified: nowIso() }, 'escribir comentario', 'note-text:<id>')` en cada cambio (la agrupación del `UndoStack` deja una entrada por ráfaga).
   - Esc o «Cerrar» → `closePopup()` + `closeUndoGroup()` y el foco vuelve a la zona activa de la anotación. «Borrar» → `deleteAnnotation(id)`.
   - Con la ventana abierta y la anotación no visible (desplazada fuera), la ventana se cierra.
4. `AnnotationLayer`: doble clic o Intro sobre la zona activa de cualquier anotación soportada → `openPopup(id)`. Al pasar el ratón sobre una con comentario, `title` nativo con los primeros 200 caracteres.
5. Icono de la nota en la capa: el mismo dibujo que la apariencia (PDF-027).
6. Tests `tests/ui/annotation-popup.test.tsx` y `tests/e2e/notes.spec.ts`.

## Criterios de aceptación
- [ ] (T) Herramienta «Nota» + clic en (100, 100) px con escala 1 → nota con `rect` cuya esquina superior izquierda corresponde a ese punto (±0,5 pt); la ventana se abre con el foco en el `textarea`; la herramienta queda en `'none'`.
- [ ] (T) Escribir «hola» (4 cambios en < 500 ms con reloj falso) → 1 entrada de deshacer «escribir comentario»; Ctrl+Z con el foco **fuera** del `textarea` → `contents ''`.
- [ ] (T) Esc devuelve el foco a la zona activa de la nota; «Borrar» la elimina.
- [ ] (T) Doble clic en un resaltado del fichero → la ventana muestra su `contents` («Comentario previo» en `annotated.pdf`) y el autor «Otra persona».
- [ ] E2E: crear una nota en `basic-5.pdf`, escribir «Revisar esta cifra», cerrar, reabrir con doble clic → el texto sigue; el icono se ve en la página (píxel del color de la nota).
- [ ] E2E accesibilidad: la ventana tiene `role="dialog"` y `aria-label`; el `textarea` tiene nombre accesible; Tab recorre `textarea` → «Borrar» → «Cerrar» y sale de la ventana (no modal).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Respuestas y estados (PDF-058). Texto enriquecido. Iconos distintos por tipo de nota.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] replanificación — 2026-10-17
- `depende_de` gana [[PDF-069-barra-comentar]]: la barra «Comentar» (`CommentToolbar`, menús Color/Grosor/Tamaño) ya no la crea PDF-030, sino PDF-069. Donde esta ficha dice «`CommentToolbar`», es el componente de PDF-069 (`src/ui/toolbar/CommentToolbar.tsx`).
