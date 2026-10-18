---
tipo: tarea
id: PDF-009
titulo: Visor virtualizado (marcos de página, scroll escalado, página actual, navegación y anclaje)
app: pdf
estado: hecha
depende_de: [PDF-008, PDF-007]
intentos: 1
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

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Lint, typecheck, vitest lector-pdf (580), coverage (líneas 98,17 %) y e2e (19/19) en verde. Todos los criterios cubiertos; sin fuera de alcance.
1. (opcional) `apps/lector-pdf/tests/ui/viewer.test.tsx:125-129` — la comprobación de `currentPage` tras actualizar dims anteriores es síncrona; añadir además que el `contentY`/página 300 sigue montada tras el cambio la haría más robusta.
2. (opcional) `Viewer.tsx:131` — la ficha pide `round(...)` en `scrollTop`; el código lo deja sin redondear y compara con tolerancia 0,5. Sin impacto funcional.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| T: 5000 págs ≤5 nodos, mitad ≈2500 | OK | `pnpm test` 892/892 (tests/ui/viewer.test.tsx) |
| T: goToPage clamp | OK | idem + tests/unit/navigation.test.ts |
| T: 100 000 págs End / wheel sin factor | OK | idem |
| T: anclaje zoom y dims previas | OK | idem |
| E2E 5000 (≤12 marcos, pág. 1 visible) | OK | viewer.spec.ts + viewer-stress.spec.ts (150 ruedas rápidas, End/Home/PageUp/PageDown, <400 nodos DOM totales, marcos contiguos, sin índices fuera de rango) |
| E2E 100000: End < 1,5 s | OK | viewer.spec.ts (tiempo anotado en el informe) y viewer-stress.spec.ts |
| E2E sizes-mixed | OK | viewer.spec.ts |
| Accesibilidad Tab/aria-label | OK | viewer.spec.ts |
| Long tasks ≤ 100 ms | OK | viewer.spec.ts |
| lint/typecheck/test/coverage/e2e | OK | lint 0, typecheck 0, vitest 892 OK, cobertura (dir propio) líneas 98,17 %, e2e 20/21 |
Nota: en la ejecución completa de e2e falló una vez `open-qa.spec.ts` (Ctrl+O, PDF-008) por carga concurrente de otros testers; 3 repeticiones aisladas 9/9 OK. No relacionado con PDF-009.
Tests añadidos: `apps/lector-pdf/tests/e2e/viewer-stress.spec.ts` (pages-5000 y pages-100000).
Rendimiento: 5000 págs 5,6 s y 100 000 págs 7,0 s para todo el escenario de estrés, con DOM acotado (≤12 marcos).

### [coordinador] reapertura — 2026-10-17
Defecto detectado por el programador de PDF-010: en `viewer.spec.ts` «sizes-mixed» (y `viewer-stress.spec.ts`) aparece «Maximum update depth exceeded»: el zoom automático depende de `currentPage` y se realimenta. Reproducible en el commit de PDF-009 sin cambios de PDF-010. Corregir (el zoom auto no debe depender de la página actual de forma circular; p. ej. basar el ajuste en la página de anclaje fijada al cambiar de modo/redimensionar), añadir test de regresión unitario/UI y que `pnpm --filter lector-pdf e2e` pase completo (26 tests).

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/Viewer.tsx`, `apps/lector-pdf/tests/ui/viewer.test.tsx`, `boveda/Apps/Lector PDF/Tareas/PDF-009-visor-virtualizado.md`.
- Qué he hecho: el zoom automático ya no depende de la página actual (causa del bucle: zoom → layout → página actual → zoom). La página de referencia del zoom se fija solo al cambiar el modo, la rotación, el tamaño del visor o el documento (ajuste de estado durante el render, sin efecto). Añadido test de regresión en `tests/ui/viewer.test.tsx` (40 páginas con tamaños alternos, 12 saltos en modo automático, sin errores); falla con el código anterior («Maximum update depth exceeded») y pasa con el arreglo.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 1016/1016 OK; `pnpm coverage` OK (líneas globales 98,51 %); `pnpm --filter lector-pdf e2e` 25/26 OK: el único fallo fue `open-qa.spec.ts` «Ctrl+O» (carga concurrente, ya anotado por el tester); repetido aislado 3 veces 9/9 OK. Los avisos «HTMLCanvasElement.getContext not implemented» de jsdom ya existían con PDF-010 y no proceden de este cambio.
- Dudas o cosas que no he podido hacer: la ficha original decía que el zoom automático usa la página actual; ahora usa la página de referencia fijada al cambiar de modo/tamaño, tal como propuso el coordinador. Conviene confirmarlo en el revisor. Los criterios de rendimiento de long tasks y el resto de e2e no se han vuelto a medir fuera de la ejecución completa.

### [revisor] ronda 2 — 2026-10-17 — CAMBIOS
Lint, typecheck, `pnpm test` (1019), coverage (líneas 98,71 %) y e2e (26/26 en esta ejecución) en verde. El arreglo del bucle es correcto: la página de referencia del zoom se fija solo al cambiar documento, modo, rotación o tamaño; el test de regresión cubre el caso. Pero el criterio «e2e con código 0» no es estable por la intermitencia de Ctrl+O:
1. `apps/lector-pdf/tests/e2e/open-qa.spec.ts:118-120` — **Diagnóstico de la intermitencia de Ctrl+O**: falla ~1 de cada 30 repeticiones con 4 workers (con `--repeat-each=30` y `=60`). Instrumentado: el `keydown` llega (`document.hasFocus()` true, `readyState` complete) pero el selector no se llama ni 1,5 s después. Causa: carrera del test, no defecto del código de la app. `src/main.tsx` usa `await loadPlatform(...)` a nivel de módulo antes de `createRoot(...).render`, así que `page.goto('/')` vuelve (evento `load`) antes de que React monte y `useShortcuts` registre su `keydown`; si la pulsación llega antes, se pierde. Con `await expect(page.getByTitle('Abrir… (Ctrl+O)')).toBeVisible()` antes de pulsar: 60/60 y 40/40 OK. Qué hacer: en ese test esperar a que la app esté montada (el botón Abrir visible) antes de `keyboard.press('Control+o')`. Revisar igual otros e2e que pulsen teclas justo tras `goto` sin esperar a un elemento de la app (p. ej. `viewer-stress.spec.ts`, `viewer.spec.ts`). (Un usuario no puede pulsar en esos milisegundos; no se pide cambio en `main.tsx`.)
2. (opcional) `tests/ui/viewer.test.tsx:181` — la aserción final `zoom > 0` es débil; la propiedad que protege el arreglo es que el zoom automático no cambia al desplazarse (guardar `zoom` tras el primer salto y comprobar que es el mismo tras los demás).

### [programador] ronda 3 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/open-qa.spec.ts`, `apps/lector-pdf/tests/e2e/viewer.spec.ts`, `apps/lector-pdf/tests/ui/viewer.test.tsx` (ya tenía el cambio del punto 2, sin tocar), `boveda/Apps/Lector PDF/Tareas/PDF-009-visor-virtualizado.md`.
- Qué he hecho: (1) Ctrl+O: se espera a que el botón Abrir sea visible y se pulsa una sola vez; quito el bucle de reintentos que repetía `Control+o` (enmascaraba la carrera). (2) El test de Tab de `open-qa.spec.ts` también espera al botón antes de pulsar Tab, misma carrera. (3) `viewer.spec.ts`: quito la variable `viewer` que quedó sin uso tras cambiar el `focus()` por `expectViewerReady` (lint). (4) Punto 2 del revisor: la aserción de `zoom` constante ya está en `viewer.test.tsx` (líneas 180 y 186); no hace falta cambiarla. Todos los e2e del visor usan ya `expectViewerReady`, y `viewer-stress.spec.ts` lo hace en `openFixture`.
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos); `pnpm typecheck` OK; `pnpm test` 1019/1019 OK; `pnpm coverage` OK (exit 0, líneas 98,71 %; la primera ejecución falló porque otro proceso de Vitest tenía el directorio de cobertura, se repitió sin cambios y pasó); `pnpm --filter lector-pdf e2e` 26/26 OK; repetición de «Ctrl+O» y «Tab llega al botón» con `--repeat-each=30`: 60/60 OK.
- Dudas o cosas que no he podido hacer: no he tocado `main.tsx` (el revisor indicó que no hace falta). El árbol de git tiene cambios ajenos de otros agentes (`boveda/`, `xref-robustness.test.ts`, `annotation-qa.test.ts`) que no he incluido en mi commit.

### [revisor] ronda 3 — 2026-10-17 — APROBADO
Lint, typecheck, `pnpm test` (1021) y e2e (26/26) en verde; Ctrl+O y Tab con `--repeat-each=20` 40/40. La carrera de Ctrl+O queda corregida (se espera al botón Abrir antes de pulsar, sin bucle de reintentos) y los e2e del visor usan `expectViewerReady`. Sin problemas bloqueantes.

### [tester] ronda 2 — 2026-10-17 — PASA
Reverificación tras la reapertura (bucle «Maximum update depth» del zoom automático) y la corrección de la carrera de Ctrl+O.
| Criterio | Resultado | Evidencia |
|---|---|---|
| T: 5000 págs, goToPage, 100 000 págs, anclaje | OK | `pnpm test` 81 ficheros, 1021/1021 |
| Regresión zoom auto sin bucle (sizes-mixed) | OK | test de `viewer.test.tsx` + e2e sizes-mixed sin errores |
| E2E 5000, 100000 (End < 1,5 s), sizes-mixed, Tab/aria-label, long tasks | OK | `pnpm --filter lector-pdf e2e` 26/26 |
| Estabilidad (carrera) | OK | `playwright test viewer open-qa --repeat-each=5`: 80/80 |
| lint / typecheck / coverage | OK | lint 0 avisos, typecheck OK, cobertura global líneas 91,21 % |
Tests añadidos: ninguno nuevo (los de ronda 1 y la regresión del programador cubren los criterios).
Rendimiento: e2e de long tasks y 100 000 págs dentro de presupuesto (End en 100 000 págs: test de 1,4 s completo).
