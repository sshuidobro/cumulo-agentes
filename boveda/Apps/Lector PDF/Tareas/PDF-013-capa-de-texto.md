---
tipo: tarea
id: PDF-013
titulo: Capa de texto - seleccionar y copiar texto; herramientas selección y mano
app: pdf
estado: en-curso
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
