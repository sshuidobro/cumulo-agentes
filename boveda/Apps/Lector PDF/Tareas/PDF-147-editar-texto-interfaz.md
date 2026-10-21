---
tipo: tarea
id: PDF-147
titulo: Editar texto - herramienta en la barra Editar, cuadro sobre la línea y E2E
app: pdf
estado: hecha
depende_de: [PDF-146, PDF-139]
intentos: 1
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-20
actualizado: 2026-10-21
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

### [programador] ronda 1 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/src/state/edit-text-actions.ts` (herramienta exclusiva con `setTool`, `editSelectedLine` para F2 y selección/búsqueda, suscripción a cambios de herramienta); `src/ui/App.tsx` (deshacer/rehacer, Escape, F2); `src/ui/shortcuts.ts` (`'edit-line'` = F2); `src/ui/messages-edit-text.ts`; `src/ui/toolbar/EditToolbar.tsx` (+ `EditTextBar.tsx`/`.module.css` nuevos); `src/ui/viewer/PageView.tsx`; `src/ui/viewer/SelectionActions.tsx`; `src/main.tsx` (`registerEditTextParticipant`). Nuevos: `src/ui/viewer/EditTextLayer.tsx`, `LineEditor.tsx`, `edit-text-box.ts` (geometría pura y familias de fuente) y sus `.module.css`; `tests/ui/edit-text-tool.test.tsx`; `tests/e2e/edit-text.spec.ts`.
- Qué he hecho: botón «Editar texto» (aria-pressed, tooltip) en la barra «Editar» con contador y «Guardar» de las ediciones; doble clic abre un `input` sobre la línea con su letra, tamaño, color y fondo de papel (blanco o modo noche), girado con `viewport.transform`; las ediciones se muestran encima de la línea original con nombre accesible, Enter/Supr. Atajos: deshacer/rehacer, Escape desactiva la herramienta, F2 abre la línea de la selección o del resultado de búsqueda actual; «Editar texto» en la barra de selección.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm coverage` OK (324 ficheros, 4170 tests; cobertura 95,06 % líneas-sentencias, umbrales cumplidos); `pnpm --filter lector-pdf e2e --project=chromium tests/e2e/edit-text.spec.ts` 7/7 OK (incluye guardado y `pdftotext`); `pnpm --filter lector-pdf e2e` completo: 392 OK, código 0 (antes del último ajuste de F2, que solo acota el atajo a «listo, sin organizar y sin pantalla completa»; los tests de App y de atajos se han vuelto a ejecutar OK).
- Dudas o cosas que no he podido hacer:
  1. **Sin test** de los criterios: aviso de texto oculto (OCR `3 Tr`, ni `scanned-es-3.pdf` ni PDF construido); zoom 125 % y 150 % con alineación ±2 px; tema oscuro de la interfaz; F2 con texto seleccionado a mano (solo se probó con resultado de búsqueda).
  2. **axe**: el criterio pide «sin violaciones». El test excluye `page-has-heading-one` y `region` (estructura de la aplicación, no de esta herramienta); el resto de reglas sí cuentan. Revisar si se acepta la exclusión.
  3. La línea base vertical se aproxima con 0,8 em (no medida con las métricas de la fuente): la alineación fina queda sin verificar a zoom distinto del 125 %.
  4. Modo noche: el texto nuevo usa `line.style.color` tal cual manda la ficha; sobre papel oscuro puede verse con poco contraste. Decisión pendiente.
  5. `EditTextLayer` se monta en cada página y devuelve `null` si no hay nada que mostrar (no se monta condicionalmente desde `PageView`).
  6. El icono del botón reutiliza `IconEdit` (no hay icono propio de «Editar texto»).

### [revisor] ronda 1 — 2026-10-21 — CAMBIOS
1. `tests/e2e/edit-text.spec.ts` — falta el E2E del aviso de texto oculto (capa OCR / PDF con `3 Tr`), criterio explícito de la ficha — añadirlo (PDF construido en el test si hace falta) y comprobar que el aviso aparece.
2. `tests/e2e/edit-text.spec.ts` — faltan zoom 125 % y 150 % con alineación del cuadro ± 2 px respecto a la línea — añadir E2E; si la línea base de 0,8 em no cumple ± 2 px, corregir la geometría en `edit-text-box.ts`.
3. `tests/ui/edit-text-tool.test.tsx` — F2 con texto seleccionado a mano sin probar (solo con resultado de búsqueda) — añadir test con selección.
4. Tema claro/oscuro sin verificar (criterio de accesibilidad) — probar la herramienta activa y el cuadro abierto en tema oscuro, con axe.
5. axe: la exclusión de `page-has-heading-one` y `region` es aceptable si es la misma que usan los otros E2E de axe del proyecto; indicarlo en el Registro. Modo noche (color del texto nuevo con poco contraste) (opcional): valorar con el líder.

### [programador] ronda 2 — 2026-10-21
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/edit-text.spec.ts` (E2E nuevos: aviso de texto oculto con un PDF de `3 Tr` construido con `buildDocument`; zoom 125 % y 150 % con alineación; F2 con texto seleccionado a mano; tema oscuro con axe; `revealText` y `expectNoAxeViolations` como ayudas); `apps/lector-pdf/tests/ui/edit-text-tool.test.tsx` (test de F2 con selección, con `selectionPageRects` espiado).
- Qué he hecho: cierro los puntos 1 a 4 del revisor con tests reales. Punto 2: la línea base de 0,8 em no se toca. Medido: el borde superior del cuadro difiere ~2,6 px de la caja de la capa de texto de pdf.js a 125 % (esa caja es más alta que `line.bounds`: 33 px frente a 30 px), pero el centro vertical queda dentro de ±2 px. El E2E compara borde izquierdo y centro vertical; no se cambió `edit-text-box.ts`. Punto 5 (axe): el filtro de `serious`/`critical` de los otros E2E de axe no excluye `page-has-heading-one` ni `region` (son `moderate`). Sin la exclusión, esas dos reglas fallan con un nodo cada una en este visor, así que la exclusión es la misma en efecto que la de los otros E2E: solo se omiten esas dos reglas de estructura de la app. Modo noche: sin cambios (punto opcional, pendiente del líder).
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm exec vitest run apps/lector-pdf/tests/ui/edit-text-tool.test.tsx` 13/13 OK; `pnpm --filter lector-pdf exec playwright test tests/e2e/edit-text.spec.ts --project=chromium` 11/11 OK; `pnpm coverage` OK (cobertura 95,06 % líneas-sentencias, umbrales cumplidos); `pnpm --filter lector-pdf e2e` completo: 396 OK, código 0. En una ejecución anterior, `compare.spec.ts` (PDF-112, teclado) falló una vez; repetido solo, 5/5 OK, y en la suite completa siguiente pasó (no tiene relación con la herramienta).
- Dudas o cosas que no he podido hacer: el criterio de alineación ±2 px se mide en E2E con el centro vertical y el borde izquierdo, no con la línea base de la fuente (no hay forma de medirla desde el DOM). Si el usuario o el revisor quieren la línea base exacta, hay que usar las métricas de la fuente en `edit-text-box.ts`; no lo he hecho por ser una decisión de geometría.

### [revisor] ronda 2 — 2026-10-21 — APROBADO
1. Lint, typecheck, test de UI (13/13) y E2E de la ficha (11/11) en verde. Los puntos 1 a 4 de la ronda 1 están cubiertos con tests reales; la exclusión de axe (`page-has-heading-one`, `region`, nivel moderate) es aceptable. (opcional) Línea base de 0,8 em y contraste del texto nuevo en modo noche: queda para el líder.

### [tester] ronda 1 — 2026-10-21 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Lint, typecheck | OK | `pnpm lint`, `pnpm typecheck` código 0 |
| Cobertura | OK | `pnpm coverage`: 95,06 % sentencias, 98,34 % líneas, umbrales cumplidos |
| E2E completo | OK | `pnpm --filter lector-pdf e2e`: 396 passed, código 0 |
| Criterio original, Escape/Ctrl+Z/Y, Cancelar, cierre de pestaña, emoji, texto oculto 3 Tr, F2 (búsqueda y selección), zoom 125/150 %, axe claro/oscuro | OK | 11 E2E en `tests/e2e/edit-text.spec.ts`, sin skip ni only |
Tests añadidos: ninguno. Rendimiento: los @perf del E2E pasan.
Notas: alineación medida con centro vertical y borde izquierdo (no línea base); contraste en modo noche queda para el líder.
