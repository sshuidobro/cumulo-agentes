---
tipo: tarea
id: PDF-013
titulo: Capa de texto - seleccionar y copiar texto; herramientas selección y mano
app: pdf
estado: en-test
depende_de: [PDF-011, PDF-004]
intentos: 0
skills: [stack-typescript-react, formatos-ofimatica, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, texto]
---

# PDF-013 · Capa de texto: seleccionar y copiar; herramienta mano

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
En cada página visible hay una capa de texto transparente alineada con el dibujo: el usuario selecciona texto con el ratón (también entre páginas), lo copia con Ctrl+C (texto Unicode normalizado) y Ctrl+A selecciona el texto de la página actual. Con la herramienta mano (H) arrastra para desplazarse; con la de selección (V) vuelve a seleccionar.

## Contexto
- Leer: `src/ui/viewer/PageView.tsx`, `Viewer.tsx`, `src/engine/pdfjs.ts`, `pdfjs-dist/web/pdf_viewer.css` (reglas `.textLayer`, `.endOfContent`, `.selecting`), y **como referencia** la clase `TextLayerBuilder` en `node_modules/pdfjs-dist/web/pdf_viewer.mjs` (métodos `render`, `#bindMouse`, `#enableGlobalSelectionListener`).
- `TextLayer` de pdf.js: `new TextLayer({ textContentSource, container, viewport })`, `render()`, `update({ viewport })`, `cancel()`, `textDivs`, `textContentItemsStr`. `textDivs[i]` corresponde al i-ésimo ítem con `str` (comprobado por el líder).
- **Parámetros de texto fijos para toda la app** (la búsqueda de PDF-017 usará los mismos para que los índices coincidan): `{ includeMarkedContent: true, disableNormalization: true }`.
- La capa necesita en el contenedor de la página las variables CSS `--scale-factor` y `--total-scale-factor` (= `zoomToScale(zoom)`), `--scale-round-x: 1px` y `--scale-round-y: 1px`.
- jsdom no tiene `canvas` 2D: en tests de componentes simula el motor con `vi.mock`; lo real se prueba en e2e.

## Qué hay que hacer
1. `src/engine/text.ts`:
   ```ts
   export const TEXT_CONTENT_PARAMS = { includeMarkedContent: true, disableNormalization: true } as const;
   export function getPageTextContent(page: PDFPageProxy): Promise<TextContent>; // page.getTextContent(TEXT_CONTENT_PARAMS)
   export interface TextLayerHandle {
     readonly textDivs: readonly HTMLElement[]; readonly items: readonly string[];
     render(): Promise<void>; update(viewport: PageViewport): void; cancel(): void;
   }
   export function createTextLayer(page: PDFPageProxy, container: HTMLElement, viewport: PageViewport): TextLayerHandle;
     // TextLayer con textContentSource = page.streamTextContent(TEXT_CONTENT_PARAMS)
   export { normalizeUnicode } from 'pdfjs-dist';
   ```
2. `src/ui/viewer/text-selection.ts`: adaptación (con comentario «Adaptado de pdf.js, web/text_layer_builder.js, Apache-2.0») de `#bindMouse` y `#enableGlobalSelectionListener`: `export function attachSelectionBehavior(textLayerDiv: HTMLElement): () => void` — crea el `div.endOfContent` al final, añade `selecting` en `mousedown`, maneja `copy` (`clipboardData.setData('text/plain', normalizeUnicode(selection.toString()).replace(/\0/g, ''))` + `preventDefault`), registra la capa en un mapa global con los oyentes `pointerdown/pointerup/blur/keyup/selectionchange` (uno solo para todas las capas, se quita con la última), incluido el ajuste de `endOfContent` para WebKit/Chromium antiguo. Devuelve la función que desregistra.
3. `src/ui/viewer/text-layer-registry.ts`: `register(pageIndex, handle)`, `unregister(pageIndex)`, `get(pageIndex)`, `subscribe(cb): () => void` (avisa al registrar/desregistrar). Lo usará el resaltado de búsqueda.
4. `src/ui/viewer/TextLayerView.tsx` (dentro de `PageView`, encima del lienzo): `div.textLayer`; al montar → `getPage`, `viewport = page.getViewport({ scale: zoomToScale(zoom), rotation: (page.rotate + rotation) % 360 })`, `createTextLayer`, `render()`, `attachSelectionBehavior`, `register`. Al cambiar zoom/rotación → `update(viewport)`. Al desmontar → `cancel`, desregistra todo. Solo para páginas `visible` u *overscan* montadas. `PageView` pone las variables CSS del Contexto en su contenedor.
5. Herramientas: store `tool: 'select' | 'hand'` (por defecto `'select'`). `MainToolbar`: dos `IconButton` con `aria-pressed` «Herramienta de selección» (V) y «Herramienta mano» (H). En modo mano: cursor `grab`/`grabbing`, la capa de texto con `pointer-events: none`, y arrastrar con el puntero (botón principal) desplaza el visor (`setPointerCapture`; usa el mismo camino de `contentYRef` del `Viewer` para respetar el scroll escalado). Iconos `IconSelect`, `IconHand`.
6. Atajos: `tool-select` `['V']`, `tool-hand` `['H']`, `select-all` `['Mod+A']` (crea un `Range` desde el primer hasta el último `textDiv` de la página actual registrada y lo pone como selección). Ctrl+C es el nativo.
7. Mensajes: `toolSelect` «Herramienta de selección», `toolHand` «Herramienta mano».
8. Tests: `tests/ui/text-layer.test.tsx` (motor simulado: monta/actualiza/cancela y registra), `tests/ui/hand-tool.test.tsx`, `tests/e2e/text.spec.ts`.

## Criterios de aceptación
- [ ] (T) Al montar `TextLayerView` se llama a `createTextLayer` una vez y se registra la página; cambiar el zoom llama a `update` (no crea otra capa); desmontar llama a `cancel` y desregistra.
- [ ] (T) `attachSelectionBehavior` añade `endOfContent`; tras desregistrar la última capa no queda ningún oyente global (espía de `document.removeEventListener` o contador interno expuesto para tests).
- [ ] (T) Herramienta mano: `pointerdown` + `pointermove` de 100 px hacia arriba aumenta el desplazamiento del visor 100 px; `H` y `V` cambian `tool`; dentro de un `<input>` `H` se escribe y no cambia la herramienta.
- [ ] E2E: en `basic-5.pdf` doble clic sobre «murciélago» → `getSelection().toString() === 'murciélago'`; arrastrar desde «Página» hasta «marcador-1» en la p1 y `Ctrl+C` → el portapapeles (`context.grantPermissions(['clipboard-read','clipboard-write'])`) contiene `Página 1 de 5` y `marcador-1`.
- [ ] E2E: la selección de una línea con zoom 200 % y con la vista girada 90° cubre el texto dibujado (captura con la selección; anota en el Registro).
- [ ] E2E: `Ctrl+A` en la p3 → la selección contiene `BUSQUEDA` y no contiene texto de la barra de herramientas.
- [ ] E2E: en `libreoffice/multilingue.pdf` copiar la línea rusa da `Привет, мир`.
- [ ] Rendimiento E2E: en `pages-5000.pdf` el número de `.textLayer` en el DOM es ≤ 12 tras 20 saltos.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Resaltado de búsqueda (PDF-018). Anotar sobre la selección (PDF-032). Respetar el permiso de "no copiar" (PDF-048).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos: `apps/lector-pdf/src/ui/viewer/TextLayerView.tsx`, `text-layer.css`, `text-layer-registry.ts`, `text-selection.ts`; `tests/ui/text-layer.test.tsx`, `tests/ui/text-selection.test.tsx`, `tests/ui/hand-tool.test.tsx`, `tests/e2e/text.spec.ts`. Modificados: `src/engine/pdfjs.ts` (exporta `normalizeUnicode`), `src/engine/text.ts` (`TEXT_CONTENT_PARAMS`, `TextLayerHandle`, `createTextLayer`), `src/state/viewer-store.ts` (`tool`, tipo `ViewTool`), `src/state/view-actions.ts` (`setViewTool`), `src/ui/viewer/PageView.tsx`, `Viewer.tsx`, `Viewer.module.css`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/icons.tsx` (`IconSelect`, `IconHand`), `src/ui/shortcuts.ts` (`tool-select` V, `tool-hand` H, `select-all` Mod+A), `src/ui/messages.ts`, `src/ui/App.tsx` (atajos V/H/Mod+A), `tests/ui/page-view.test.tsx` y `tests/ui/tauri-integration.test.tsx` (mock de `createTextLayer`, jsdom no tiene canvas).
- Qué he hecho: capa de texto por página (`TextLayerView` dentro de `PageView`, creada con pdf.js, registrada y con selección adaptada de pdf.js, copia NFKC sin NUL); registro de capas y «Seleccionar todo» (Mod+A sobre la página actual); herramientas selección (V) y mano (H) con `aria-pressed`, arrastre que pasa por `contentYRef` del visor y `pointer-events: none` en la capa con la mano.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf typecheck` OK; `pnpm lint` OK (0 avisos); `pnpm test` OK (93 ficheros, 1235 tests); `pnpm coverage` OK (líneas 96,67 % global); `pnpm --filter lector-pdf e2e` OK (40 passed, de ellos 6 de `text.spec.ts`). Captura del criterio de zoom 200 % y giro 90°: el test adjunta la captura con la selección (`testInfo.attach`); la comprobación automática es que el rectángulo de la selección contiene el del texto dibujado (tolerancia 2 px). Revisé a ojo una captura previa a la selección a 200 % girada: el texto dibujado aparece girado y legible; la alineación de la selección la comprueba el test, no la captura.
- Desviaciones de la ficha (decisiones tomadas en implementación, para revisión):
  1. `normalizeUnicode` se reexporta desde `src/engine/pdfjs.ts` (único punto que importa `pdfjs-dist`), no directamente desde `pdfjs-dist` en `text.ts`.
  2. Cambio de rotación: la capa se vuelve a montar (la `key`/dependencia de `rotation` en el efecto de montaje) en vez de `update(viewport)`. Motivo: en pdf.js 6.4 `TextLayer.update` solo recoloca los ítems si cambia la escala; con un giro sin cambio de zoom el texto quedaría mal alineado. El zoom sí usa `update` como pide la ficha.
  3. Las variables CSS (`--scale-factor`, `--total-scale-factor`, `--scale-round-x/y`) van en el `div.textLayer` y no en el marco de la página; tienen el mismo efecto porque la capa las hereda.
  4. `text-layer.css` es una copia reducida de las reglas de `.textLayer`, `.endOfContent` y `.selecting` de pdf_viewer.css (sin anidar), con la atribución Apache-2.0 en el comentario.
  5. Añado el mensaje `msg.selectAll` («Seleccionar todo el texto de la página») para la descripción del atajo Mod+A, que la ficha no listaba.
  6. Los botones de herramienta se desactivan sin documento abierto, igual que zoom y giro (sin esto, rompían el orden de Tab de `open.test.tsx`).
  7. La prueba de H/V usa un componente con los mismos manejadores que `App` sobre el registro real de atajos, no `App` completo (App necesita un documento cargado).
- Dudas o cosas que no he podido hacer: (a) No he hecho `git commit`: el usuario pidió no hacer commits mientras PDF-012 trabaja en paralelo. Los ficheros compartidos `App.tsx`, `shortcuts.ts`, `messages.ts`, `MainToolbar.tsx`, `icons.tsx`, `viewer-store.ts`, `viewer.test.tsx` y `zoom-controls.test.tsx` tienen también cambios de PDF-012 sin commitear; un commit de esta ficha debe separar esas partes. (b) Los criterios de aceptación siguen sin marcar: los verifica el tester. (c) No he ejecutado `pnpm perf`: la ficha no lo pide.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Comprobado: `pnpm lint` (0 avisos), `pnpm typecheck`, `pnpm test` (93 ficheros, 1235 tests) y `text.spec.ts` (6/6) en verde. No he repetido `pnpm coverage` ni el e2e completo (los reporta el programador; los repite el tester).
- Desviaciones 1-7 aceptadas: la rotación con remontaje está bien justificada y cubierta por test; el resto no cambia el comportamiento exigido.
- Sin problemas bloqueantes. Sugerencias (opcional):
  1. `apps/lector-pdf/src/ui/App.tsx` (`select-all`) — el atajo hace `preventDefault` aunque `selectPageText` devuelva `false` (página sin capa o sin texto) y anula el Ctrl+A nativo — devolver `false` del manejador en ese caso (ya soportado por `useShortcuts`).
  2. `apps/lector-pdf/src/ui/viewer/text-selection.ts` — el manejador `copy` está en cada capa; con una selección que abarca varias páginas el evento no pasa por ellas y se copia sin `normalizeUnicode` (como en pdf.js, pero con `disableNormalization: true` pueden quedar ligaduras). Valorar un único `copy` en el visor. No hay criterio que lo exija.
- Nota para el commit: la ficha comparte ficheros sin commitear con PDF-012 (`App.tsx`, `shortcuts.ts`, `messages.ts`, `MainToolbar.tsx`, `Viewer.tsx`, `use-shortcuts.ts`); hay que separar las partes al comitear.
