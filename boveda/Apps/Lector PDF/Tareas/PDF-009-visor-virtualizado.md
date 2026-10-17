---
tipo: tarea
id: PDF-009
titulo: Visor virtualizado (marcos de página, scroll escalado, página actual, navegación y anclaje)
app: pdf
estado: en-revision
depende_de: [PDF-008, PDF-007]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, visor, rendimiento]
---

# PDF-009 · Visor virtualizado

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Con un documento abierto, el área central muestra una columna de **marcos de página** (blancos, con su tamaño real y el número de página) en la que solo existen en el DOM las páginas visibles ± 1. El scroll funciona igual con 5 o 100 000 páginas (incluido el escalado de scroll), se sabe la página actual, se puede pedir "ir a la página N" y el visor no salta cuando cambian zoom, rotación o dimensiones. El dibujo del contenido llega en PDF-010.

## Contexto
- Leer: `src/core/layout.ts`, `page-dims.ts`, `zoom.ts` (PDF-006/007), `src/state/viewer-store.ts`, `src/state/document-actions.ts` (PDF-008), [[ADR-0007-motor-y-visor-pdf]].
- jsdom no calcula layout ni tiene `ResizeObserver`: en tests de componentes, simula tamaños (`Object.defineProperty(el, 'clientHeight', ...)`), un `ResizeObserver` falso en `tests/setup/` y dispara `scroll` a mano. Lo visual real se prueba en e2e.
- `useEffect` solo para sincronizar con el DOM/eventos; derivados con `useMemo`.

## Qué hay que hacer
1. Store (`viewer-store.ts`) añade: `zoomMode: ZoomMode` (por defecto `DEFAULT_ZOOM_MODE`), `zoom: number` (efectivo, 1), `rotation: Rotation` (0), `navRequest: NavRequest | null`. `openDocument` restablece `rotation 0`, `zoomMode` por defecto y `navRequest null`.
2. `src/state/navigation.ts`:
   ```ts
   export interface NavRequest { readonly seq: number; readonly page: number; readonly yFraction: number; readonly xFraction: number | null }
   export function goToPage(page: number, opts?: { readonly yFraction?: number; readonly xFraction?: number }): void; // clamp a [0, numPages-1]; seq creciente
   export function setCurrentPage(page: number): void;  // solo hace set si cambia
   ```
3. `src/ui/viewer/use-viewport-size.ts`: `useViewportSize(ref): { width: number; height: number }` con `ResizeObserver`.
4. `src/ui/viewer/Viewer.tsx` (+ `Viewer.module.css`):
   - Contenedor de scroll `div` con `tabIndex={0}`, `role="region"`, `aria-label={msg.documentRegion(name)}`, `data-testid="viewer"`; dentro un espaciador de alto `map.scrollHeight` y ancho `max(layout.maxWidth + 2*padding, viewport.width)`, y una capa de páginas.
   - `zoom` efectivo = `resolveZoom(zoomMode, tamaño en pt rotado de currentPage, viewport, { width: 2*DEFAULT_PADDING + 16, height: 2*DEFAULT_PADDING })`; si difiere del store, `set({ zoom })` en un efecto.
   - `layout = useMemo(computeLayout(dims, { scale: zoomToScale(zoom), rotation, gap: DEFAULT_GAP, padding: DEFAULT_PADDING }), [dims, dimsVersion, zoom, rotation])`; `map = scrollMap(layout, viewport.height)`.
   - **Fuente de verdad del scroll vertical: `contentYRef`** (px de contenido). Al recibir `scroll`: si el `scrollTop` lo puso el propio visor (bandera), se ignora; si no, `contentY = scrollTopToContentY(scrollTop, map)`. El render se programa con `requestAnimationFrame` (un estado `contentY` de React actualizado como mucho una vez por frame).
   - Si `map.factor > 1`: escucha `wheel` (`{ passive: false }`, sin Ctrl) y teclas `ArrowUp/ArrowDown` (±40 px), `PageUp/PageDown/Space` (± alto − 40), `Home` (0) y `End` (`maxContentY`) en el contenedor: `preventDefault`, mueve `contentYRef` (clamp a `[0, maxContentY]`) y pone `scrollTop = round(contentYToScrollTop(...))` marcando la bandera. Con `factor === 1` todo es scroll nativo.
   - Páginas montadas: `visibleRange(layout, contentY, contentY + vh, 1)`. Cada una se coloca con `position:absolute`, `top = tops[i] - contentY + scrollTop`, `left = (anchoEspaciador - widths[i]) / 2`.
   - Página actual = `pageAtY(layout, contentY + vh / 3)` → `setCurrentPage`.
   - Anclaje: guarda `anchorAt(layout, contentY)` tras cada scroll; cuando cambia la identidad de `layout`, en `useLayoutEffect` recoloca `contentY = contentYForAnchor(nuevo, ancla)`.
   - `navRequest` nuevo (`seq` distinto del último atendido): `contentY = clamp(tops[page] + yFraction*heights[page] - 8)`; si `xFraction` no es null y el contenido es más ancho que el viewport, ajusta `scrollLeft` para centrar ese punto.
   - Tras abrir un documento, el contenedor recibe el foco.
5. `src/ui/viewer/PageFrame.tsx`: `{ index, numPages, top, left, width, height }` → `div` con `data-page-index`, `aria-label={msg.pageOf(index+1, numPages)}`, fondo blanco, sombra `var(--shadow-page)`, y el número de página centrado en gris (marcador mientras no hay lienzo). `React.memo`.
6. `App.tsx`: en `ready` muestra `<Viewer />` en vez del `div` de PDF-008 (conserva el `data-testid="document-ready"` en el contenedor de la app para los e2e).
7. Mensajes: `documentRegion(name)` → «Documento «name»», `pageOf(n, total)` → «Página n de total».
8. Tests: `tests/ui/viewer.test.tsx` (jsdom, store preparado con una `PageDimsTable` sin pdf.js) y `tests/e2e/viewer.spec.ts`.

## Criterios de aceptación
- [ ] (T) Con 5 000 páginas y viewport de 800 px, tras montar hay ≤ 5 nodos `[data-page-index]`; tras fijar `scrollTop` a la mitad y disparar `scroll`, siguen ≤ 5 y el índice montado está cerca de 2 500 (±2).
- [ ] (T) `goToPage(4999)` monta la página 4999 y `currentPage` pasa a 4999; `goToPage(-3)` → 0; `goToPage(99999)` → última.
- [ ] (T) Con 100 000 páginas (`factor > 1`): `End` sobre el visor monta la última página; `wheel` con `deltaY 100` mueve el contenido 100 px (no `100 * factor`).
- [ ] (T) Anclaje: en la página 300 a mitad, cambiar `zoomMode` a `{ kind: 'custom', zoom: 2 }` mantiene `currentPage` 300; actualizar `dims` de páginas **anteriores** (otro tamaño) tampoco cambia `currentPage`.
- [ ] E2E: abrir `pages-5000.pdf` → `document.querySelectorAll('[data-page-index]').length ≤ 12` tras recorrerlo con 20 saltos aleatorios (`goToPage` vía teclado `End`/`Home` y scroll con `mouse.wheel`); la página 1 está visible al abrir.
- [ ] E2E: abrir `pages-100000.pdf`, pulsar `End` en el visor → el marco con `aria-label` «Página 100000 de 100000» es visible en < 1,5 s.
- [ ] E2E: `sizes-mixed.pdf` muestra la 2.ª página más ancha que alta y la 5.ª (rotada 90) más ancha que alta.
- [ ] Accesibilidad: el visor es enfocable con Tab y tiene foco visible; las páginas tienen `aria-label`.
- [ ] Rendimiento: durante el scroll continuo en e2e (`mouse.wheel` 50 veces), ninguna *long task* > 100 ms (`PerformanceObserver({ type: 'longtask' })` inyectado en la página; anota la máxima).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Dibujar el contenido (PDF-010). Botones de zoom/rotación (PDF-011). Campo de página (PDF-012). Doble página (PDF-050).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/state/viewer-store.ts`, `src/state/navigation.ts` (nuevo), `src/ui/App.tsx`, `src/ui/App.module.css`, `src/ui/messages.ts`, `src/ui/viewer/{Viewer.tsx, PageFrame.tsx, use-viewport-size.ts, Viewer.module.css}` (nuevos), `tests/setup/setup.ts`, `tests/setup/resize-observer.ts` (nuevo), `tests/unit/navigation.test.ts` (nuevo), `tests/ui/viewer.test.tsx` (nuevo), `tests/e2e/viewer.spec.ts` (nuevo).
- Qué he hecho: store con `zoomMode`, `zoom`, `rotation` y `navRequest`; `goToPage`/`setCurrentPage` (acotado y con `seq` creciente); visor con scroll escalado (`contentYRef` como fuente de verdad, eco de `scrollTop` ignorado, rueda y teclado solo si `factor > 1`), páginas montadas ± 1, página actual en el tercio superior, anclaje al cambiar layout y foco al abrir. `App` monta `Viewer` y conserva `data-testid="document-ready"` en un texto oculto (lectores de pantalla) con el recuento.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` (raíz) 855 tests OK antes del último ajuste del contenedor; tras él `vitest --project lector-pdf` 580 tests OK; `pnpm coverage` OK (líneas globales 88,26 %); `pnpm --filter lector-pdf e2e` 19/19 OK (incluidos los 5 de visor). Tarea larga máxima en el e2e de scroll: ver anotación del test (≤ 100 ms).
- Dudas o cosas que no he podido hacer: (1) el ancla se calcula al cambiar el layout a partir del layout anterior y `contentY` (equivalente a guardarla tras cada scroll, pero sin estado extra). (2) Los marcos de página llevan `role="group"`: `aria-label` en un `div` sin rol no es válido. (3) En modo «auto» con documentos de tamaños mezclados, el zoom sigue a la página actual; el ancla evita saltos, pero conviene revisarlo en el e2e de PDF-022 con `sizes-mixed`. (4) PDF-021 y PDF-026 no los he tocado: son fichas distintas y no forman parte de esta.
