---
tipo: tarea
id: PDF-130
titulo: Añadir texto e imagen - barra «Editar» y herramientas
app: pdf
estado: pendiente
depende_de: [PDF-059, PDF-129, PDF-115, PDF-116]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
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
   - `'page-text'`: mismo flujo que el texto libre (`beginFreeText`…`commitFreeText`) pero la anotación creada lleva `flatten: true`, color de texto por defecto negro, sin borde ni fondo, y tamaño de fuente de la barra.
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
- [ ] Unit: la anotación creada por `'page-text'` y `'page-image'` lleva `flatten: true`; la de texto libre normal, no.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Editar texto o imágenes que ya están en el PDF ([[PDF-065-editar-texto]]). Fuentes distintas de Helvetica.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
