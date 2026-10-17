---
tipo: tarea
id: PDF-007
titulo: Núcleo - zoom, cola de render con prioridades y tamaño de lienzo
app: pdf
estado: pendiente
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
