---
tipo: tarea
id: PDF-007
titulo: Núcleo - zoom, cola de render con prioridades y tamaño de lienzo
app: pdf
estado: hecha
depende_de: [PDF-001]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, rendimiento]
---

# PDF-007 · Núcleo: zoom, cola de render y tamaño de lienzo

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Tres módulos puros: cálculo de zoom (pasos, ajustar ancho/página, rueda, texto ↔ número), una cola de trabajos de render con prioridad, cancelación y concurrencia limitada, y el cálculo del tamaño del lienzo con límite de píxeles.

## Contexto
- Leer: [[ADR-0007-motor-y-visor-pdf]] (render: 2 trabajos simultáneos, 33 554 432 píxeles por lienzo).
- Solo `core/`. `AbortController`/`AbortSignal` existen en Node 22 (no es DOM).
- 100 % = tamaño real: 1 punto PDF = 96/72 px CSS.

## Qué hay que hacer
1. `src/core/zoom.ts`:
   ```ts
   export const CSS_UNITS = 96 / 72;
   export const MIN_ZOOM = 0.1; export const MAX_ZOOM = 8;
   export const ZOOM_STEPS: readonly number[] = [0.1, 0.25, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5, 6.4, 8];
   export type ZoomMode = { readonly kind: 'auto' } | { readonly kind: 'fit-width' } | { readonly kind: 'fit-page' } | { readonly kind: 'custom'; readonly zoom: number };
   export const DEFAULT_ZOOM_MODE: ZoomMode = { kind: 'auto' };
   export const AUTO_MAX_ZOOM = 1.25;
   export interface Size { readonly width: number; readonly height: number }
   export function clampZoom(z: number): number;
   export function zoomToScale(z: number): number;                 // z * CSS_UNITS
   export function nextZoom(current: number, direction: 1 | -1): number; // siguiente paso estrictamente mayor/menor (tolerancia 1e-6); en el extremo devuelve el extremo
   export function fitZoom(kind: 'fit-width' | 'fit-page', pagePt: Size, viewport: Size, margin: Size): number;
     // fit-width: (vw - margin.width) / (pagePt.width * CSS_UNITS); fit-page: mínimo con (vh - margin.height) / (pagePt.height * CSS_UNITS); clamp
   export function resolveZoom(mode: ZoomMode, pagePt: Size, viewport: Size, margin: Size): number;
     // auto = min(fit-width, AUTO_MAX_ZOOM) (como pdf.js); custom = clampZoom(zoom)
   export function formatZoom(z: number): string;                  // Math.round(z*100) + ' %'  → "125 %"
   export function parseZoomInput(text: string): number | null;    // "150", "150%", "150 %", "150,5" → 1.5 / 1.505; vacío o no numérico → null; fuera de rango → clamp
   export function wheelZoom(current: number, deltaY: number, deltaMode: 0 | 1 | 2): number;
     // factor = Math.exp(-deltaY * k), k = 0.002 (píxeles, 0), 0.05 (líneas, 1), 0.5 (páginas, 2); clamp
   ```
   `pagePt` es el tamaño **ya rotado** de la página de referencia.
2. `src/core/render-queue.ts`:
   ```ts
   export interface RenderJob { readonly key: string; readonly priority: number; run(signal: AbortSignal): Promise<void>; }
   export class RenderQueue {
     constructor(concurrency?: number);           // por defecto 2
     request(job: RenderJob): void;               // misma key pendiente → se reemplaza; misma key en curso → se aborta y la nueva queda pendiente
     cancel(key: string): void;                   // quita de pendientes o aborta la que está en curso
     cancelAll(): void;
     setPriority(key: string, priority: number): void; // solo afecta a pendientes
     get pendingCount(): number; get runningCount(): number;
     onIdle(): Promise<void>;                     // resuelve cuando no hay nada pendiente ni en curso
   }
   ```
   Menor número = más prioridad; a igual prioridad, orden de llegada. Un `run` que rechaza: si su señal estaba abortada se ignora; si no, `createLogger('render').warn(...)` y la cola sigue. Arranca trabajos en microtarea (no dentro de `request`) para que varias `request` seguidas se ordenen por prioridad.
3. `src/core/canvas-size.ts`:
   ```ts
   export const MAX_CANVAS_PIXELS = 33_554_432; export const MAX_CANVAS_DIM = 32_767;
   export interface CanvasPlan { readonly width: number; readonly height: number; readonly outputScale: number; readonly capped: boolean }
   export function planCanvas(cssWidth: number, cssHeight: number, devicePixelRatio: number): CanvasPlan;
   ```
   `s = dpr` (mínimo 1); si `w*s * h*s > MAX_CANVAS_PIXELS` → `s = sqrt(MAX / (w*h))`; si `w*s` o `h*s` > `MAX_CANVAS_DIM` → reduce `s` para que quepa; `width = floor(w*s)`, `height = floor(h*s)` (mínimo 1); `capped = s < dpr`.
4. Tests `tests/unit/zoom.test.ts`, `render-queue.test.ts`, `canvas-size.test.ts`.

## Criterios de aceptación
- [ ] (T) `nextZoom(1, 1)` → 1.1; `nextZoom(1.05, -1)` → 1; `nextZoom(8, 1)` → 8; `nextZoom(0.1, -1)` → 0.1.
- [ ] (T) `fitZoom('fit-width', {612,792}, {1000,800}, {32,32})` ≈ 1.1863 (±0,0001); `fit-page` con los mismos datos ≈ 0.7273; `resolveZoom({ kind: 'auto' }, ...)` con viewport 1000 → 1.1863 y con viewport 3000 → 1.25.
- [ ] (T) `formatZoom(1.25)` → `'125 %'`; `parseZoomInput('150 %')` → 1.5; `'150,5'` → 1.505; `'abc'` → null; `'5000'` → 8; `'1'` → 0.1.
- [ ] (T) `wheelZoom(1, -100, 0)` ≈ 1.2214; `wheelZoom(1, 100, 1)` ≈ 0.0067 → clamp 0.1.
- [ ] (T) Cola con concurrencia 2 y 5 trabajos de prioridades `[3,1,2,0,1]` pedidos seguidos: el orden de inicio es `0,1,1,2,3` (por clave); nunca hay más de 2 en curso (contador en los trabajos falsos).
- [ ] (T) `request` de una clave en curso aborta su señal y la vuelve a ejecutar; `cancel` de una pendiente impide que empiece; `cancelAll` deja `pendingCount 0` y aborta las en curso; `onIdle` resuelve al final.
- [ ] (T) Un trabajo que rechaza sin abortar no detiene la cola y llama al logger (sink falso).
- [ ] (T) `planCanvas(612, 792, 2)` → `1224×1584`, `capped false`; `planCanvas(612*8, 792*8, 2)` → `width*height ≤ 33 554 432`, `capped true`; `planCanvas(40000, 10, 1)` → `width ≤ 32 767`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; los 3 ficheros ≥ 95 % de líneas.

## Fuera de alcance
- Barra de zoom y atajos (PDF-011). Render real con pdf.js (PDF-010).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/core/zoom.ts`, `apps/lector-pdf/src/core/render-queue.ts`, `apps/lector-pdf/src/core/canvas-size.ts`, `apps/lector-pdf/tests/unit/zoom.test.ts`, `apps/lector-pdf/tests/unit/render-queue.test.ts`, `apps/lector-pdf/tests/unit/canvas-size.test.ts` (y esta ficha).
- Qué he hecho: implementados los tres módulos puros según la ficha. La cola arranca trabajos en microtarea, ordena por prioridad y llegada, cuenta como «en curso» un trabajo abortado hasta que su `run` termina (la concurrencia nunca se supera) y no relanza la misma clave mientras la anterior sigue viva. Los 44 tests cubren todos los criterios (T) de la ficha.
- Comandos ejecutados y resultado:
  - `vitest run` (suite completa): 42 ficheros y 493 tests en verde.
  - Cobertura de los tres módulos (`--coverage.include` sobre `core/zoom.ts`, `core/render-queue.ts`, `core/canvas-size.ts`): líneas 100 %, ramas 98,3 %. El informe se escribió en un directorio propio porque otro proceso de vitest tenía bloqueado `coverage/`.
  - ESLint sobre mis ficheros: limpio. Prettier con el estilo del repo (`--single-quote --print-width 120`): limpio.
  - `pnpm lint` y `pnpm typecheck` del proyecto fallan por ficheros que no son míos y están sin commitear de otro programador (PDF-005): `tests/unit/engine-load.test.ts` (import type) y `src/engine/load.ts` / `src/engine/range-transport.ts` (propiedad inexistente y falta `override`). En mis ficheros no hay errores.
- Dudas o cosas que no he podido hacer (ver revisión posterior: lint y typecheck ya pasan): `pnpm lint` y `pnpm typecheck` a nivel de repo no pasan hasta que PDF-005 corrija sus ficheros. Los criterios de cobertura se han comprobado solo para los tres módulos. Decisiones menores tomadas dentro de la ficha: `parseZoomInput` redondea a 10 decimales para evitar ruido de coma flotante; `planCanvas` acepta `devicePixelRatio` no finito o menor que 1 como 1; `clampZoom`, `fitZoom` y `planCanvas` lanzan `RangeError` ante valores no finitos (bug del llamante).

### [revisor] ronda 1 — 2026-10-17 — APROBADO
- `pnpm lint` y `pnpm typecheck` de la raíz: código 0. `pnpm test`: 44 ficheros, 514 tests en verde.
- `pnpm coverage` falla solo por bloqueo del directorio `coverage/` por otro proceso vitest; con directorio propio, los tres módulos: líneas 100 %, ramas 98,3 %.
- Cumple cada criterio (T); cola correcta (concurrencia con abortados, reemplazo de pendientes, microtarea, logger); sin `skip`/`only`; nada fuera de alcance.
- (opcional) El tester debe repetir `pnpm coverage` cuando no haya otro vitest en marcha.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Criterios (T) de zoom, fitZoom/resolveZoom, formato/parse, rueda | OK | `vitest run`: zoom.test.ts en verde; recorrido completo de ZOOM_STEPS arriba y abajo en el test QA |
| Cola: prioridades, concurrencia ≤ 2, abort, cancel, cancelAll, onIdle, logger | OK | render-queue.test.ts en verde; QA: 20 requests con claves repetidas + cancelAll, máx. 2 simultáneos |
| planCanvas | OK | canvas-size.test.ts en verde; QA: 0×0 y 10×40000 a dpr 3 |
| lint / typecheck / test | código 0 | `pnpm lint`, `pnpm typecheck`; `pnpm test`: 44 ficheros, 514 tests |
| Cobertura ≥ 95 % | OK | directorio propio: líneas 100 %, ramas 98,3 % (los 3 ficheros) |

Tests añadidos: `apps/lector-pdf/tests/unit/pdf007-qa.test.ts` (8 tests: entradas raras de parseZoomInput, setPriority, run síncrono que lanza, concurrencia inválida, extremos).
Rendimiento: no aplica (núcleo puro).
Observación no bloqueante: `wheelZoom` lanza RangeError si `deltaY` finito es enorme (|deltaY| > ~3,5e5 px desborda `exp`); irreal con una rueda real, pero conviene acotar `deltaY` en PDF-011.
`pnpm coverage` estándar no se ejecutó por el bloqueo de `coverage/`; se usó directorio propio.
