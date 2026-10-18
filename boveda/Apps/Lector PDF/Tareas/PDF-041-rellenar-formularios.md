---
tipo: tarea
id: PDF-041
titulo: Rellenar campos de texto, combos y listas en pantalla
app: pdf
estado: cambios-pedidos
depende_de: [PDF-081]
intentos: 1
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/FormLayer.tsx`, `FormLayer.module.css` (nuevos); `src/ui/messages-forms.ts` (nuevo); `src/ui/viewer/PageView.tsx` (montaje tras `AnnotationLayer`); `src/ui/toolbar/MainToolbar.tsx` (botón «Resaltar campos»); `src/ui/icons.tsx` (`IconFormFields`); `src/ui/theme.css` (`--form-highlight`); `src/state/form-actions.ts` (aviso una vez por documento); tests `tests/ui/form-layer.test.tsx`, `tests/ui/form-highlight-toggle.test.tsx`, `tests/unit/form-notice.test.ts`, `tests/e2e/forms-text.spec.ts`.
- Qué he hecho: capa `FormLayer` con un control por widget de texto (input, password, textarea), combo (select o input con datalist si es editable) y lista (select múltiple o simple), posicionados con las esquinas del widget pasadas al viewport. El texto se confirma al salir o con Intro (no en multilínea), Esc descarta y devuelve el foco al visor; combo y lista confirman en cada cambio. Resaltado, estilos con/sin foco, modo noche, pointer-events con herramienta de anotación activa, botón de barra y aviso al abrir un documento con campos rellenables.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (183 ficheros, 2148 tests); `pnpm coverage` OK (líneas 98,98 %); `pnpm --filter lector-pdf e2e` OK (184 pruebas, incluido `chromium-perf`); E2E `forms-text.spec.ts` 4/4; `bundle:check` 478 040 bytes (máx. 500 000).
- Dudas o cosas que no he podido hacer:
  - `convertToViewportRectangle` no existe en pdf.js 6.4 (lo dice `LinkLayer`): uso las cuatro esquinas con `convertToViewportPoint`, mismo resultado.
  - Combo editable: la ficha pide confirmar en `change`, pero un `<input list>` confirmaría en cada tecla. Lo confirmo al salir o con Intro, como el texto.
  - `<select>` no admite `readonly`: combos y listas de solo lectura van con `disabled`.
  - El aviso «hay campos» no estaba en la lista de ficheros de la ficha: se dispara en `importPages` de `form-actions.ts`, el único sitio donde llegan los campos.
  - E2E de «pais»: la tecla «p» (búsqueda por inicial) elige Portugal en un solo cambio; dos flechas darían dos entradas de deshacer.
  - Para revisar: tras Ctrl+Z el «Ana» lo pinta pdf.js desde el valor, no la apariencia original del fichero (en `form-full.pdf` difieren unos 12 500 píxeles de la p2). Es coherente con ADR-0019, pero la comparación de píxeles en el E2E se ha escrito contando ese caso.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
Comprobado: `pnpm lint` (raíz) 0 avisos, `pnpm --filter lector-pdf typecheck` OK, tests de la ficha (19) en verde. Criterios cubiertos por tests UI y E2E; sin ficheros fuera de la ficha salvo `form-actions.ts` (aviso), justificado en el Registro. Las desviaciones del programador (esquinas con `convertToViewportPoint`, combo editable confirma al salir/Intro, `disabled` en select de solo lectura) son razonables.
1. (opcional) `apps/lector-pdf/src/ui/theme.css:39-40` — la línea `--shadow-page` del bloque oscuro de `prefers-color-scheme` perdió la sangría tras insertar `--form-highlight` — reindentar.
2. (opcional) `theme.css` — `--form-highlight` idéntico en claro y oscuro; vale, pero conviene que el tester compruebe el contraste en tema oscuro.

### [tester] ronda 1 — 2026-10-18 — FALLA
| Criterio | Resultado | Evidencia |
|---|---|---|
| UI / E2E de la ficha (controles, Tab/Esc/Intro, pointer-events, Luis, Portugal, zoom+rotación) | PASA | `pnpm --filter lector-pdf e2e`: 184 passed (4,3 min, incluye axe y `chromium-perf`), código 0 |
| Axe serious/critical p1 | PASA | dentro del e2e anterior |
| Presupuestos | PASA | `pnpm perf`: 17 ficheros, 28 tests, código 0 |
| lint, typecheck, test, coverage | PASA | código 0; líneas 98,98 % |
| Contraste en oscuro (sugerencia del revisor) | FALLA | `--form-highlight` es igual en claro y oscuro. En modo noche (fondo `#1f1f23`, texto `#e6e6e6`) el resaltado compuesto es ~`rgb(126 132 156)` y el texto de la página queda a 2,96:1 (< 4,5:1 AA). En claro es 17,4:1. Con el tema oscuro del sistema pero sin modo noche, la página sigue blanca (17,4:1), sin problema. |

Reproducir: abrir `form-full.pdf`, activar modo noche, pulsar «Resaltar campos»: el texto de los campos rellenos (p. ej. «Ana») se lee mal sobre el azul claro.
Arreglo pedido: en `FormLayer.module.css` añadir `.night.highlight { background: rgb(r g b / a%); }` con un azul oscuro (p. ej. `rgb(60 80 160 / 55%)`) que dé >= 4,5:1 con `#e6e6e6`. Opcional: reindentar `--shadow-page` en `theme.css` (nota 1 del revisor).
Tests añadidos: `apps/lector-pdf/tests/unit/form-highlight-contrast.test.ts` (ROJO hasta que exista la regla `.night.highlight`). Rendimiento: sin regresión (`pnpm perf` y `chromium-perf` OK).
