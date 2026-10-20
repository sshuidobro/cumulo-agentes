---
tipo: tarea
id: PDF-147
titulo: Editar texto - herramienta en la barra Editar, cuadro sobre la línea y E2E
app: pdf
estado: pendiente
depende_de: [PDF-146, PDF-139]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion]
---

# PDF-147 · Editar texto: herramienta en la barra Editar, cuadro sobre la línea y E2E

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0042-editar-texto-linea-simple]] · Antes: [[PDF-146-editar-texto-estado]], [[PDF-139-firma-digital-interfaz]] (última de la cadena en serie de interfaz)

## Objetivo
El usuario activa «Editar texto» en la barra «Editar», hace doble clic en una línea, la corrige en un cuadro colocado encima con un aspecto parecido, ve las líneas ya editadas sobre la página, puede deshacer o restaurar, y con Ctrl+S guarda tras la confirmación.

## Contexto
- [[ADR-0042-editar-texto-linea-simple]]; acciones y mensajes de [[PDF-146-editar-texto-estado]]: `src/state/edit-text-actions.ts`, `src/state/edit-text-store.ts`, `src/ui/messages-edit-text.ts`.
- `src/ui/toolbar/EditToolbar.tsx` (PDF-130, con «Redactar» de PDF-137): dónde y cómo se añade una herramienta.
- `src/ui/viewer/FreeTextEditor.tsx` + `.module.css` → patrón de cuadro de texto colocado sobre la página (posición con `viewport`, foco, Escape).
- `src/ui/viewer/PageView.tsx` (capas por página y `viewport`), `src/ui/viewer/TextLayerView.tsx`, `src/ui/viewer/SelectionActions.tsx`.
- `src/ui/shortcuts.ts` (`ShortcutId`, registro) y el sitio donde se llama `useShortcuts({ … undo … })` (`grep -rn "useShortcuts(" apps/lector-pdf/src`).
- E2E de referencia: `tests/e2e/redact.spec.ts` (PDF-137), descarga del guardado y lectura con `pdftotext`.

## Qué hay que hacer
1. `EditToolbar.tsx`: botón conmutador «Editar texto» (`aria-pressed`, tooltip `editTextMsg.toolHint`) que llama a `setEditTextTool`; al activar otra herramienta se desactiva. Con ediciones: texto `editTextMsg.edited(n)` y botón «Guardar» que llama a `saveTextEdits`.
2. `src/ui/viewer/EditTextLayer.tsx` (+ `.module.css`), montada en `PageView` encima de la capa de texto solo si `active` o hay ediciones en la página:
   - Con la herramienta activa: doble clic → `convertToPdfPoint` → `beginLineEdit(pageIndex, punto)`; cursor de texto.
   - Cada edición pendiente de la página: rectángulo opaco del color del fondo de página (`#fff`; también en tema oscuro y en modo noche se usa el mismo fondo de papel que el lienzo) sobre `line.bounds` (convertido con `viewport`), y encima el texto nuevo en la línea base `origin`, `font-size = fontSize × escala`, color `line.style.color`, negrita/cursiva y `font-family` según la familia: Helvetica → `Helvetica, Arial, "Liberation Sans", sans-serif`; Times → `"Times New Roman", Times, "Liberation Serif", serif`; Courier → `"Courier New", Courier, "Liberation Mono", monospace`. Borde discontinuo azul al pasar el ratón o con foco; `role="button"`, `tabIndex=0`, `aria-label` = `editTextMsg.editorLabel(página)` + texto; Enter o doble clic la reabre (`beginLineEdit` con un punto dentro); Supr → `removeLineEdit`.
   - Página girada (`/Rotate`): la caja y el texto se giran con la misma transformación del `viewport` (CSS `transform` a partir de `viewport.transform`).
3. `src/ui/viewer/LineEditor.tsx` (+ `.module.css`): `<input type="text">` sobre `line.bounds` (ancho mínimo el de la línea, crece con el texto), con el mismo estilo que arriba y fondo opaco que tapa la línea original; valor inicial = texto de la edición o `original`; foco y texto seleccionado al abrir. Enter o perder el foco → `commitLineEdit`; Escape → `cancelLineEdit`. Bajo el cuadro, el error de `validateLineText` (`role="alert"`); con error, Enter no cierra. `aria-label` = `editorLabel(página)`. Mientras `status === 'probing'`, cursor de espera en la página.
4. Atajos: con la herramienta activa, `undo`/`redo` (Ctrl+Z, Ctrl+Y, Ctrl+Mayús+Z) van a `editTextUndo`/`editTextRedo`; nuevo `ShortcutId` `'edit-line'` con `F2`: edita la línea de la selección de texto actual (punto = centro del primer rectángulo de `selectionPageRects`) o, sin selección, la del resultado de búsqueda actual. `SelectionActions.tsx` gana «Editar texto» (activa la herramienta y hace lo mismo que F2). Escape con el cuadro cerrado desactiva la herramienta (`cancel-tool`).
5. Arranque: `registerEditTextParticipant()` donde se registran los demás participantes.
6. Tests: `tests/ui/edit-text-tool.test.tsx` (Testing Library) y `tests/e2e/edit-text.spec.ts`.

## Criterios de aceptación
- [ ] **Criterio original** (E2E): `basic-5.pdf` → «Editar texto» → doble clic en «Texto de búsqueda en la página dos.» (página 2) → el cuadro aparece con ese texto → escribir «Texto de búsqueda en la hoja dos.» → Enter → la página muestra el texto nuevo → Ctrl+S → «Guardar» → el PDF descargado, con `pdftotext`, contiene «la hoja dos» y no «la página dos», y conserva «Página 2 de 5» y «marcador-2».
- [ ] E2E: Escape en el cuadro no crea edición; Ctrl+Z quita la edición y Ctrl+Y la repone; «Cancelar» en la confirmación no cambia el fichero; con ediciones, cerrar la pestaña pregunta.
- [ ] E2E: escribir «😀» muestra «El carácter «😀» no se puede escribir con los tipos de letra estándar.» y Enter no cierra el cuadro.
- [ ] E2E: doble clic en una línea de la capa OCR invisible (página de `scanned-es-3.pdf` tras reconocer texto, o PDF con `3 Tr` construido en el test) → aviso de texto oculto.
- [ ] UI: el cuadro usa `font-family` serif para una línea Times y monoespaciada para Courier; F2 con texto seleccionado abre el cuadro; Supr sobre una edición enfocada la restaura.
- [ ] Teclado y accesibilidad: botón con `aria-pressed` y tooltip; cuadro y ediciones con nombre accesible; foco visible; axe sin violaciones con la herramienta activa y con el cuadro abierto; tema claro y oscuro; zoom 125 % y 150 % (el cuadro sigue alineado con la línea ± 2 px en E2E).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Cambiar tipo de letra, tamaño o color de la línea; reflujo; editar varias líneas a la vez ([[ADR-0042-editar-texto-linea-simple]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
