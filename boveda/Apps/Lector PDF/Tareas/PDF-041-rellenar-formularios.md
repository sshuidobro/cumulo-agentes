---
tipo: tarea
id: PDF-041
titulo: Rellenar campos de texto, combos y listas en pantalla
app: pdf
estado: en-curso
depende_de: [PDF-081]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, formularios, ui]
---

# PDF-041 · Rellenar campos de texto, combos y listas en pantalla

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0019-formularios-acroform]] · Paridad: [[Paridad Adobe Acrobat]] (área 5)

## Objetivo
Sobre cada página visible hay una capa con un control HTML por widget de texto, combo y lista: se rellena con ratón o teclado, el valor se confirma al salir del campo (una entrada de deshacer), Esc descarta lo escrito y el lienzo muestra el valor pintado por pdf.js. Botón «Resaltar campos» en la barra cuando el documento tiene campos.

## Contexto
- Leer: `src/ui/viewer/PageView.tsx` (capas y `viewport`), `src/ui/viewer/AnnotationLayer.tsx` (cómo convierte a píxeles con el `viewport`), `src/ui/viewer/LinkLayer.tsx`, `src/state/form-actions.ts` y `form-store.ts` (PDF-081), `src/ui/toolbar/MainToolbar.tsx`, `src/ui/kit/IconButton.tsx`, `src/ui/icons.tsx`, `src/ui/use-shortcuts.ts` (Ctrl+Z dentro de un campo es el deshacer nativo del navegador).
- Textos nuevos en un fichero propio `src/ui/messages-forms.ts` (`export const formMsg = {...} as const`), para no chocar con otras fichas en `messages.ts`.
- Posición de un widget en píxeles: `viewport.convertToViewportRectangle([...rect])` → `[x1, y1, x2, y2]`; `left = min(x1,x2)`, `top = min(y1,y2)`, `width = |x2−x1|`, `height = |y2−y1|`.

## Qué hay que hacer
1. `src/ui/viewer/FormLayer.tsx` + `FormLayer.module.css`: `export function FormLayer({ pageIndex, viewport }: { pageIndex: number; viewport: PageViewport })`. Lee `useForms(s => s.byPage.get(pageIndex))`, `useForms(s => s.fields)`, `useForms(s => s.highlight)`, `useAnnotations(s => s.edits.fields)`, `useAnnotations(s => s.tool)` y `useAppearance(s => s.nightMode)`. Contenedor `div.layer` absoluto a página completa con `pointer-events: none`; cada control `pointer-events: auto`, salvo con una herramienta de anotación activa (`tool !== 'none'`): entonces ninguno.
2. Un control por widget de los tipos `text`, `combo`, `list` (los demás los hace PDF-083), en el orden de `byPage`:
   - `text`: `<input type="text">` (o `type="password"` si `password`; `<textarea>` si `multiline`), `maxLength` = `maxLen` si > 0, `readOnly` si el campo no es rellenable, `aria-label` = `tooltip || name`, `aria-required` si `required`, `title` = `tooltip || name`.
   - `combo`: `<select>` con `<option value={exportValue}>{displayValue}</option>`; si `editable`, `<input list>` + `<datalist>`.
   - `list`: `<select multiple={multiSelect} size={max(2, options.length)}>`.
   - Tamaño de letra CSS = `(fontSize || 12) × viewport.scale` (combo y texto de una línea automáticos: `min(12, (alto_pt − 4)/1.15) × scale`).
3. Edición del texto: estado local mientras tiene el foco (empieza con el valor efectivo). Confirmar (`setFieldValue`) al perder el foco y con Intro en `<input>` (no en `<textarea>`). Esc: vuelve al valor efectivo y lleva el foco al visor (`[data-testid=viewer]`). Combo y lista confirman en `change` (una entrada por cambio).
4. Estilos: en reposo (`.idle`) texto transparente (`color: transparent`) y fondo transparente o `var(--form-highlight)` si `highlight`; con el foco (`.editing`) fondo opaco y texto visible (`#fff`/`#000`; con modo noche `#1f1f23`/`#e6e6e6`), borde de foco visible `outline: 2px solid var(--color-focus)`. Define `--form-highlight: rgb(204 215 255 / 55%)` en `src/ui/theme.css` (claro y oscuro). Campos de solo lectura: cursor normal y sin resaltado.
5. Montar `<FormLayer>` en `PageView.tsx` después de `AnnotationLayer` (encima) y antes de `AnnotationPopup`.
6. Barra: en `MainToolbar.tsx`, botón conmutador «Resaltar campos» (`IconButton pressed`, icono nuevo `IconFormFields` en `icons.tsx`) visible solo si `useForms(s => s.fields.size > 0)`; llama a `setFormHighlight`.
7. Aviso al abrir un documento con campos rellenables (una vez por documento, al importar el primero): `showNotice(formMsg.hasFields)` = «Este documento tiene campos de formulario que puedes rellenar.».
8. Tests: `tests/ui/form-layer.test.tsx` (jsdom, Testing Library) y `tests/e2e/forms-text.spec.ts`.

## Criterios de aceptación
- [ ] UI (`form-full.pdf`): la p1 tiene 10 controles de texto/combo/lista con nombre accesible `nombre`, `comentarios`, `codigo`, `importe`, `pais`, `idiomas`, `persona.apellido`, `solo_lectura`, `Campo obligatorio` y `rotado`; `solo_lectura` tiene `readonly`; `codigo` tiene `maxlength=6`; `comentarios` es `textarea`; `obligatorio` tiene `aria-required="true"`.
- [ ] UI: escribir «Luis» en `nombre` y salir con Tab → `setFieldValue` una vez con `{kind:'text', text:'Luis'}`; escribir «X» y pulsar Esc → no se llama y el campo vuelve a «Ana»; Intro en `nombre` confirma; Intro en `comentarios` añade salto de línea.
- [ ] UI: con la herramienta «Resaltar» activa, los controles tienen `pointer-events: none` (estilo calculado).
- [ ] E2E: escribir «Luis» en `nombre` (clic + teclado) y pulsar Tab → en el lienzo de la p2 la zona del widget de `nombre` (repetido) cambia respecto a la captura previa (≥ 20 píxeles distintos: pdf.js pinta «Luis» con el storage) y el título de la ventana lleva «• »; Ctrl+Z con el foco en el visor → la p1 y la p2 vuelven a «Ana» (el `input` muestra «Ana»).
- [ ] E2E: elegir «Portugal» en `pais` con el teclado (foco + flechas) → valor `pt`; Ctrl+Z → «España».
- [ ] E2E: con zoom 200 % y rotación 90° los controles siguen sobre su widget (centro del `input` dentro del rect convertido ±2 px).
- [ ] Axe sin incidencias `serious`/`critical` en la p1 de `form-full.pdf`.
- [ ] Presupuestos sin regresión: `pnpm --filter lector-pdf e2e` completo con código 0 (incluido `chromium-perf`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Casillas, botones de opción, tabulación entre páginas y E2E de guardar (PDF-083). Guardar (PDF-042). Formato y cálculo con JavaScript. Edición girada (el control se muestra horizontal sobre un widget girado).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
