---
tipo: tarea
id: PDF-130
titulo: Añadir texto e imagen - barra «Editar» y herramientas
app: pdf
estado: hecha
depende_de: [PDF-059, PDF-129, PDF-115, PDF-116, PDF-149]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion, ui]
---

# PDF-130 · Añadir texto e imagen: barra «Editar» y herramientas

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0036-anadir-contenido-aplanando]] · Antes: [[PDF-059-anadir-texto-imagen]]

## Objetivo
Un botón «Editar» en la barra principal abre la barra «Editar» con dos herramientas: «Añadir texto» (clic o arrastre, escribir, tamaño y color) e «Añadir imagen» (elegir PNG/JPEG y colocarla, mover y redimensionar). Se deshacen, se recuperan tras un cierre inesperado y se guardan con Ctrl+S como contenido de la página.

## Contexto
- `src/state/annotation-actions.ts` → `beginFreeText`, `commitFreeText`, `setTool`, `chooseSignature`, `placeSignature`, `placeSignatureFromKeyboard`, `executeEdit`.
- `src/state/annotation-store.ts` → `AnnotationTool`, `commentBarOpen`.
- `src/ui/toolbar/CommentToolbar.tsx` (patrón de barra secundaria), `src/ui/toolbar/MainToolbar.tsx`, `src/ui/App.tsx:100-186`.
- `src/ui/viewer/AnnotationLayer.tsx` (clic de herramienta, creación de texto libre, colocación de firma), `src/ui/viewer/annotation-shapes.tsx`, `src/ui/signature/image-art.ts` → `signatureFromImageFile`.
- `services().platform.importFile` (COM-018); `useViewer.permissions.modify`, `securityMsg`.

## Qué hay que hacer
1. `annotation-store.ts`: `AnnotationTool` gana `'page-text'` y `'page-image'`; estado `editBarOpen: boolean` (como `commentBarOpen`; se cierra al abrir la de comentar y viceversa).
2. `annotation-actions.ts`:
   - `'page-text'`: mismo flujo que el texto libre (`beginFreeText`…`commitFreeText`) pero la anotación creada lleva `flatten: true` y `borderless: true` (campo de [[PDF-149-texto-libre-sin-borde]]; el fondo ya es transparente), `textColor` por defecto negro `[0, 0, 0]` (añade la entrada `'page-text'` en `DEFAULT_TOOL_COLORS`) y tamaño de fuente de la barra.
   - `export async function choosePageImage(): Promise<void>`: `importFile([{ name: 'Imágenes', extensions: ['png','jpg','jpeg'] }], 20 MB)` → `signatureFromImageFile` (mismo tratamiento que la firma de imagen) → herramienta `'page-image'` con el arte pendiente; el clic en la página la coloca con `flatten: true` (ancho por defecto 200 pt, proporción conservada); con teclado, `placeSignatureFromKeyboard` equivalente en el centro de la vista.
   - Sin permiso de modificar (`!permissions.modify`) → aviso una vez por documento `editMsg.modifyAnyway` y se permite (como comentar).
3. `src/ui/toolbar/EditToolbar.tsx` (`role="toolbar"`, `aria-label` «Editar»): «Añadir texto» (T), «Añadir imagen» (abre el selector), tamaño de fuente y color (reutiliza los controles de `CommentToolbar`), «Cerrar».
4. `MainToolbar.tsx`: botón «Editar» (`aria-pressed`). `App.tsx`: muestra `EditToolbar` cuando `editBarOpen`.
5. `AnnotationLayer.tsx` / `annotation-shapes.tsx`: los aplanados pendientes se ven igual que quedarán (sin icono de comentario ni popup); seleccionados, contorno discontinuo y `title` «Contenido de la página (se fijará al guardar)». Mover, redimensionar, editar texto y Supr funcionan como en texto libre y firma.
6. `src/ui/messages-edit.ts` (`editMsg`): `editButton` «Editar», `addText` «Añadir texto», `addImage` «Añadir imagen», `close`, `pendingContent` «Contenido de la página (se fijará al guardar)», `modifyAnyway` «Este PDF no permite modificar su contenido; tus cambios se guardarán igualmente en tu copia.», `imageTooBig`.
7. Tests: `tests/unit/annotation-actions.test.ts` (casos nuevos), `tests/ui/edit-toolbar.test.tsx`, `tests/e2e/edit-content.spec.ts`.

## Criterios de aceptación
- [ ] **Criterio original** (E2E): `basic-5.pdf` → Editar → Añadir texto → clic en la página 1, escribir «Añadido por mí» → Ctrl+S → tras recargar, la búsqueda (Ctrl+F) de «Añadido por mí» encuentra 1 coincidencia en la página 1, el texto se puede seleccionar y copiar, y el panel de comentarios no lo lista.
- [ ] E2E: Añadir imagen (PNG de prueba) → colocar → redimensionar → Ctrl+Z deshace el redimensionado → Ctrl+S → la imagen se ve en el lienzo tras recargar y no es una anotación (la herramienta de selección no la selecciona).
- [ ] E2E: con un texto añadido sin guardar, recargar la página → el aviso de recuperación lo restaura.
- [ ] Teclado: Editar y sus herramientas se activan con teclado; Escape sale de la herramienta; axe sin violaciones; tema oscuro.
- [ ] Unit: la anotación creada por `'page-text'` y `'page-image'` lleva `flatten: true`; la de `'page-text'` además `borderless: true` y `textColor` `[0, 0, 0]`; la de texto libre normal no lleva ni `flatten` ni `borderless`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Editar texto o imágenes que ya están en el PDF ([[PDF-065-editar-texto]]). Fuentes distintas de Helvetica.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: ninguno (no he tocado código ni tests; solo el estado de esta ficha).
- Qué he hecho: he leído la ficha, las dependencias (PDF-059, PDF-129, PDF-115 y PDF-116 están en `hecha`), ADR-0036, el store de anotaciones, `annotation-actions.ts`, `AnnotationLayer.tsx`, `annotation-shapes.tsx` y el modelo. No he implementado nada porque la ficha tiene una contradicción que no puedo resolver sin decidir diseño.
- Comandos ejecutados y resultado: ninguno (no había cambios que verificar).
- Dudas o cosas que no he podido hacer:
  1. **«Sin borde ni fondo» para `'page-text'` no es posible con el modelo actual.** `FreeTextAnnotation` dibuja siempre un rectángulo de 1 pt con `a.color` (`annotation-shapes.tsx`, `FreeTextShape`, y `freeTextDrawing` en `core/annotations/appearance.ts`); no existe ningún campo para omitirlo, y `color` no admite «transparente». Para cumplirlo hace falta una decisión de modelo: (a) un campo opcional nuevo en `FreeTextAnnotation` (p. ej. `frame?: false`), con su validación en `isAnnotation` y el dibujo en las dos rutas (vista y aplanado), o (b) aceptar el borde de color en el texto que se añade. Pregunta para el líder: ¿cuál?
  2. Mientras no se decida, la ficha pide también un color de texto negro por defecto para `'page-text'`: `DEFAULT_TOOL_COLORS` no tiene entrada para esa herramienta; la añadiré junto con la decisión de la duda 1.
  3. El resto de la ficha (barra «Editar», `'page-image'`, `choosePageImage`, aviso `editMsg.modifyAnyway`, tests) lo implemento en cuanto se resuelva la duda 1; no dependen de ella salvo el texto aplanado.

### [lider] replanificación — 2026-10-20
- Duda 1 resuelta: opción (a). Campo opcional `borderless?: true` en `FreeTextAnnotation`, independiente de `flatten`. Se hace en la ficha nueva [[PDF-149-texto-libre-sin-borde]] (modelo, validación, apariencia, vista y tests); esta ficha depende de ella.
- Duda 2: añadir `'page-text'` a `DEFAULT_TOOL_COLORS` con negro `[0, 0, 0]` (ya en el paso 2).
- Ficha de vuelta a `pendiente`, `intentos: 0`. El programador puede adelantar todo lo que no es `'page-text'` mientras PDF-149 no esté hecha.

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `src/core/annotations/palette.ts`, `src/core/signature/signature.ts` (`PAGE_IMAGE_WIDTH_PT`, `width` opcional en `signatureRectAt`, `flatten` en `newSignatureAnnotation`), `src/state/annotation-store.ts` (`page-text`, `page-image`, `editBarOpen`), `src/state/annotation-actions.ts` (`beginFreeText` con `page-text`, `choosePageImage`, `placeSignature` aplanada con `page-image`, `setEditBarOpen`, aviso `editMsg.modifyAnyway`), `src/ui/messages-edit.ts` (nuevo), `src/ui/toolbar/EditToolbar.tsx` (nuevo), `src/ui/toolbar/CommentToolbar.tsx` (exporta `colorEntries`, `fontSizeEntries`, `applyColor`, `ColorTarget`), `src/ui/toolbar/MainToolbar.tsx` (botón «Editar»), `src/ui/App.tsx`, `src/ui/icons.tsx` (`IconPageImage`), `src/ui/viewer/AnnotationLayer.tsx` (herramientas nuevas, título «Contenido de la página»), `src/ui/viewer/Viewer.tsx` y `Viewer.module.css` (Intro y cursor de `page-image`/`page-text`). Tests: `tests/unit/annotations/page-content-actions.test.ts`, `tests/ui/edit-toolbar.test.tsx`, `tests/e2e/edit-content.spec.ts`.
- Qué he hecho: he aplicado la decisión de la ronda 1 (`borderless` de PDF-149 y `'page-text'` negro en `DEFAULT_TOOL_COLORS`). «Añadir texto» crea texto libre con `flatten` y `borderless`; «Añadir imagen» elige PNG/JPEG (20 MB), la deja pendiente y la coloca a 200 pt con `flatten`. La barra «Editar» (botón, tamaño, color y cerrar) se excluye de «Comentar» en ambos sentidos. Los cambios sobre anotaciones aplanadas usan el permiso de modificar y avisan con `editMsg.modifyAnyway`.
- Comandos ejecutados y resultado: `pnpm lint` (sin avisos); `pnpm typecheck` (OK); `pnpm coverage` (309 ficheros, 3999 tests, OK, código 0); `pnpm --filter lector-pdf e2e`: 358 pasan y 1 falla: «exportar pages-5000 (@perf) › «Cancelar» a mitad no descarga nada». Ese fallo **ya ocurre en HEAD sin mis cambios** (lo comprobé en un worktree de `HEAD`), así que es preexistente y no lo he tocado. Los 4 tests E2E nuevos pasan.
- Dudas o cosas que no he podido hacer:
  1. **Fallo E2E preexistente**: la ficha pide `pnpm --filter lector-pdf e2e` con código 0 y ahora no lo cumple por ese test de exportación (@perf). Hace falta decidir si se arregla en su ficha de exportación o se deja como excepción.
  2. **Pre-existente, en la firma (no en mi código)**: tras colocar una firma o una imagen con un clic, el propio clic la deselecciona (el clic de fondo llega al `svg` y `clearAnnotationSelection` limpia la selección), así que el tirador de tamaño no aparece hasta hacer clic en la anotación. Los tests lo hacen así. Lo dejo anotado para el líder.
  3. «Editar» no se guarda entre sesiones (como «Comentar» sí); queda como estado de la ventana. Lo he elegido así porque la ficha no lo dice.
  4. El color de «Añadir texto» cambia la herramienta, no el texto ya seleccionado. Lo he dejado así por la misma razón.


### [revisor] ronda 1 — 2026-10-20 — APROBADO
- `pnpm lint` y `pnpm typecheck` OK; tests nuevos (unit + UI) 18/18 OK. Diff acorde a la ficha, sin nada fuera de alcance; el aviso `modifyAnyway` va por separado del de comentar, `flatten`/`borderless` solo en las herramientas nuevas.
- E2E `exportar pages-5000 › «Cancelar» a mitad` verificado: falla igual en `81934f0` (sin PDF-130, worktree limpio) y en HEAD; es **real y preexistente** (el botón «Cancelar» del diálogo de progreso no llega a pulsarse), no flaky ni causado por esta ficha. Debe abrirse ficha propia en export; hasta entonces `e2e` no da código 0.
- (opcional) El tema oscuro y Escape-sale-de-herramienta no tienen test E2E propio; el axe solo cubre el tema claro.
- (opcional) Duda 2 del programador (clic de colocación deselecciona la firma/imagen) conviene anotarla como ficha aparte.

### [tester] ronda 1 — 2026-10-20 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Lint / typecheck | OK | `pnpm lint`, `pnpm typecheck` sin avisos |
| Coverage | OK | `pnpm coverage`: líneas 98,33 %, sin tests rojos |
| E2E texto (guardar, buscar, copiar, no en comentarios) | OK | `edit-content.spec.ts` pasa |
| E2E imagen (redimensionar, Ctrl+Z, guardar, no es anotación) | OK | ídem |
| E2E recuperación tras recarga | OK | ídem |
| Axe (tema claro) | OK | ídem |
| Unit flatten/borderless/textColor | OK | `page-content-actions.test.ts` en coverage |
| `pnpm --filter lector-pdf e2e` código 0 | EXCEPCIÓN | 358 pasan, 1 falla: `export.spec.ts:194` «Cancelar» a mitad (@perf). Preexistente (revisor lo verificó en `81934f0`), sin relación con PDF-130 |
- Huecos menores (no bloquean): Escape como salida de herramienta y tema oscuro sin E2E propio; el clic de colocación deselecciona la imagen (preexistente en firma).
- Pedido al líder: abrir ficha propia para el fallo de export @perf (hasta entonces e2e no da 0).
Tests añadidos: ninguno. Rendimiento: no aplica.
