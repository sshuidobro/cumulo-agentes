---
tipo: tarea
id: PDF-076
titulo: Dibujar la vista previa del trazo de forma incremental en un canvas temporal (test rojo previo)
app: pdf
estado: en-revision
depende_de: []
intentos: 0
skills: [pruebas-calidad, calidad-profesional]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, pdf, anotaciones, rendimiento]
---

# PDF-076 · Vista previa del trazo en canvas

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0018-vista-previa-del-trazo-en-canvas]] · Origen: [[PDF-073-e2e-long-tasks-en-serie]] (ronda 1, `ink` [79, 145] ms) · Función: [[PDF-035-dibujo-a-mano]]

## Objetivo
Que dibujar a mano alzada cueste lo mismo por frame con 10 o con 2 000 puntos y con 0 o 500 anotaciones en la página: sin re-render de `AnnotationLayer` por frame y sin copiar el trazo. Hoy cada frame hace `setInkPreview(stroke.points.slice())` (re-render de toda la capa + copia O(n) + cadena `points` O(n)).

## Contexto
- Leer: [[ADR-0018-vista-previa-del-trazo-en-canvas]], `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx` (interfaz `InkStroke`, `beginInk`, `moveInk`, `requestInkPreview`, `clearInk`, `endInk` y el bloque JSX `inkPreview !== null`), `src/ui/viewer/AnnotationLayer.module.css`, `src/ui/viewer/annotation-geometry.ts` (`cssColor`), `tests/ui/ink.test.tsx` (en especial el test «mientras se traza, la vista previa es una polilínea…»), `tests/e2e/ink.spec.ts` (helpers `pickInkTool`, `setZoom`, `visiblePart`, `redPixels`).
- Rutas relativas a `apps/lector-pdf/`.

## Qué hay que hacer
1. **Rojo primero** en `tests/ui/ink.test.tsx` (pegar en el Registro la salida en rojo antes de tocar `src/`):
   - `beforeEach` del `describe`: `vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeCtx as never)`, donde `fakeCtx` es un objeto nuevo por test con `beginPath`, `moveTo`, `lineTo`, `stroke`, `setTransform`, `clearRect` como `vi.fn()` y propiedades `lineWidth`, `lineCap`, `lineJoin`, `strokeStyle`. `afterEach`: `vi.restoreAllMocks()` y `vi.unstubAllGlobals()` (si ya hay `afterEach`, añádelo allí).
   - Test nuevo «durante el trazo la capa no se vuelve a renderizar por frame y dibuja solo los segmentos nuevos»:
     - `vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length; })` y `vi.stubGlobal('cancelAnimationFrame', () => undefined)`.
     - Renderiza `<Profiler id="ink" onRender={() => { commits += 1; }}><AnnotationLayer pageIndex={0} viewport={fakeViewport()} /></Profiler>` (`Profiler` de `react`) con la herramienta «Dibujar» activa (como los demás tests).
     - `pointerDown` en (10, 10) y vacía la cola de frames dentro de `act`. Guarda `before = commits`.
     - 100 veces: `pointerMove` a (10 + 3i, 10 + i) y vacía la cola dentro de `act` (`frames.splice(0).forEach((cb) => { cb(0); })`).
     - Espera: `commits - before === 0`; `fakeCtx.lineTo` llamado **100** veces en total (101 puntos distintos → 100 segmentos); `container.querySelector('[data-testid="ink-preview"]')` no es `null`.
     - `pointerUp` → el lienzo ya no está y `inks()` tiene 1 elemento.
   - Sustituye el test «mientras se traza, la vista previa es una polilínea que se actualiza por frame y desaparece al soltar» por «mientras se traza, la vista previa es un lienzo que dibuja y desaparece al soltar»: tras `pointerDown` + `pointerMove`, `waitFor` → existe `[data-testid="ink-preview"]` y `fakeCtx.lineTo` se ha llamado al menos 1 vez; tras `pointerUp` el lienzo no existe y hay 1 dibujo. Es un cambio de especificación decidido en ADR-0018, no un test desactivado.
2. Nuevo `src/ui/viewer/ink-preview.ts` (sin React):
   ```ts
   export interface InkPreviewStyle {
     readonly color: string;
     /** Grosor en puntos PDF (el contexto ya está en coordenadas PDF). */
     readonly widthPt: number;
   }
   export interface InkViewport {
     readonly width: number;
     readonly height: number;
     readonly transform: readonly number[];
   }
   export type InkContext = Pick<CanvasRenderingContext2D, 'beginPath' | 'moveTo' | 'lineTo' | 'stroke'>;

   /** Ajusta el lienzo al viewport y a `dpr`, y deja el contexto en coordenadas PDF con el estilo del trazo. `null` si no hay contexto 2D. */
   export function prepareInkCanvas(canvas: HTMLCanvasElement, viewport: InkViewport, dpr: number, style: InkPreviewStyle): CanvasRenderingContext2D | null;

   /**
    * Dibuja los segmentos de `points` ([x0, y0, x1, y1, ...]) que faltan desde `drawn` (coordenadas ya dibujadas; 0 al
    * empezar), unidos con el último punto ya dibujado. Devuelve el nuevo `drawn`. O(puntos nuevos).
    */
   export function drawInkSegments(ctx: InkContext, points: readonly number[], drawn: number): number;
   ```
   - `prepareInkCanvas`: `canvas.width = Math.round(viewport.width * dpr)`, `canvas.height = Math.round(viewport.height * dpr)`, `canvas.style.width = \`${viewport.width}px\``, `canvas.style.height = \`${viewport.height}px\``; `getContext('2d')` (si `null`, devuelve `null`); con `const [a = 1, b = 0, c = 0, d = 1, e = 0, f = 0] = viewport.transform`, `ctx.setTransform(a * dpr, b * dpr, c * dpr, d * dpr, e * dpr, f * dpr)`; `lineWidth = style.widthPt`, `lineCap = 'round'`, `lineJoin = 'round'`, `strokeStyle = style.color`.
   - `drawInkSegments`, exactamente:
     ```ts
     const start = Math.max(0, drawn - 2);
     if (points.length - start < 4) return drawn;
     ctx.beginPath();
     ctx.moveTo(points[start] ?? 0, points[start + 1] ?? 0);
     for (let i = start + 2; i + 1 < points.length; i += 2) ctx.lineTo(points[i] ?? 0, points[i + 1] ?? 0);
     ctx.stroke();
     return points.length;
     ```
3. `AnnotationLayer.tsx`:
   - `InkStroke` gana `ctx: CanvasRenderingContext2D | null` y `drawn: number` (mutables); `beginInk` los crea con `null` y `0`.
   - Sustituye `const [inkPreview, setInkPreview] = useState<readonly number[] | null>(null);` por `const [inkActive, setInkActive] = useState(false);` y añade `const inkCanvasRef = useRef<HTMLCanvasElement>(null);`.
   - `beginInk`: tras `inkStroke.current = stroke;` → `setInkActive(true);`.
   - Cuerpo del callback de `requestInkPreview`:
     ```ts
     stroke.frame = null;
     if (inkStroke.current !== stroke) return;
     const canvas = inkCanvasRef.current;
     if (stroke.ctx === null && canvas !== null) {
       stroke.ctx = prepareInkCanvas(canvas, viewport, window.devicePixelRatio || 1, { color: cssColor(inkColor), widthPt: inkWidth });
     }
     if (stroke.ctx !== null) stroke.drawn = drawInkSegments(stroke.ctx, stroke.points, stroke.drawn);
     ```
   - `clearInk`: `setInkPreview(null)` → `setInkActive(false)`.
   - JSX: borra el bloque `{inkPreview !== null && ( … <polyline … /> … )}`. Justo después de `</svg>` (antes de `FreeTextEditor`): `{inkActive && <canvas ref={inkCanvasRef} className={styles.inkPreview} data-testid="ink-preview" aria-hidden="true" />}`. Si `svgPointsForPath` deja de usarse en este fichero, quita su import.
4. `AnnotationLayer.module.css`: `.inkPreview { position: absolute; left: 0; top: 0; z-index: 3; pointer-events: none; }`.
5. Nuevo `tests/unit/ink-preview.test.ts` (`// @vitest-environment jsdom`):
   - `drawInkSegments` con 4 000 coordenadas añadidas de 40 en 40 (100 llamadas, reutilizando el `drawn` devuelto): `lineTo` 1 999 veces, `moveTo` 100, `stroke` 100; el `moveTo` de la llamada k (k ≥ 2) es el último punto de la llamada k − 1.
   - Con 2 coordenadas (un punto) no llama a nada y devuelve el `drawn` recibido.
   - `prepareInkCanvas` con viewport 100 × 50, `transform [2, 0, 0, -2, 0, 100]`, `dpr` 1,5: `canvas.width 150`, `height 75`, `style.width '100px'`, `setTransform(3, 0, 0, -3, 0, 150)`, `lineWidth`, `lineCap`, `lineJoin` y `strokeStyle` según el estilo. Con `getContext` devolviendo `null` → `null`.
6. Nuevo `tests/e2e/ink-preview.spec.ts` (sin `@perf`), con `for (const zoom of ['50', '300'])` y los mismos pasos de apertura que `ink.spec.ts` (copia los helpers que necesites): «con zoom N % la vista previa se ve bajo el puntero antes de soltar»: `mouse.down` en `start`, `mouse.move` a `end = start + (120, 0)` con `steps: 10`, **sin soltar**, `expect.poll(() => redPixels(page, caja 7 × 7 centrada en el punto medio)).toBeGreaterThan(0)`; luego `mouse.up` y el dibujo existe (`[role="button"][aria-label^="Dibujo"]` = 1).

## Criterios de aceptación
- [ ] Rojo previo en el Registro: el test nuevo del paso 1 falla con el código actual (commits ≈ 100, no 0).
- [ ] `pnpm --filter lector-pdf exec vitest run tests/ui/ink.test.tsx tests/unit/ink-preview.test.ts` en verde; los demás tests de `ink.test.tsx` no cambian.
- [ ] `pnpm --filter lector-pdf e2e --project=chromium -g "ink|Dibujo|trazo"` con código 0 (incluye `ink-preview.spec.ts` a 50 % y 300 % y los de `ink.spec.ts`).
- [ ] Rendimiento, con la máquina en reposo (antes: `uptime` con carga de 1 min < 1,0 y `pgrep -fa "playwright|vitest|vite build"` vacío; pegar ambos): `pnpm --filter lector-pdf exec playwright test --project=chromium-perf --no-deps --repeat-each=5 -g "trazo de 2 000"` → 5 pasan.
- [ ] Teclado/deshacer/temas: sin cambios de comportamiento (Ctrl+Z quita el dibujo: lo cubre `ink.spec.ts`); la vista previa usa el color de la herramienta en ambos temas.
- [ ] Escalado 125 %/150 %: cubierto por el test de `dpr` 1,5 del paso 5.
- [ ] Con la herramienta inactiva no hay ningún `<canvas>` extra en la página (el presupuesto «≤ 12 lienzos» no cambia): `[data-testid="ink-preview"]` solo existe durante el trazo (lo comprueba el paso 1).
- [ ] `git diff` no cambia umbrales ni añade `retries`, `test.skip`, `.only` o `waitForTimeout`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` y `pnpm perf` con código 0.

## Fuera de alcance
- Cambiar la simplificación del trazo al soltar (`simplifyPath`) o cómo se guarda el dibujo.
- La prueba `@perf` de `ink.spec.ts` (no se toca).
- OffscreenCanvas / worker.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/src/ui/viewer/ink-preview.ts` (nuevo), `apps/lector-pdf/src/ui/viewer/AnnotationLayer.tsx`, `apps/lector-pdf/src/ui/viewer/AnnotationLayer.module.css`, `apps/lector-pdf/tests/ui/ink.test.tsx`, `apps/lector-pdf/tests/unit/ink-preview.test.ts` (nuevo), `apps/lector-pdf/tests/e2e/ink-preview.spec.ts` (nuevo), esta ficha.
- Qué he hecho: rojo previo en `ink.test.tsx` (contexto 2D simulado en `beforeEach` del `describe`, `afterEach` con `restoreAllMocks`/`unstubAllGlobals`, test de `Profiler` y el test de la polilínea sustituido por el del lienzo). Después, `ink-preview.ts` (`prepareInkCanvas`, `drawInkSegments`) y `AnnotationLayer` con lienzo temporal `data-testid="ink-preview"` montado solo durante el trazo; `requestInkPreview` dibuja solo los segmentos nuevos; el estado de React cambia solo al empezar y al soltar. El CSS `.inkPreview` según la ficha. Tests unitarios de `ink-preview` y e2e `ink-preview.spec.ts` a 50 % y 300 %.
- Desviación menor: el contexto simulado se pasa como `fakeCtx as unknown as CanvasRenderingContext2D` en vez de `as never`, para no usar un cast que anule el tipo.
- Rojo previo (`pnpm --filter lector-pdf exec vitest run tests/ui/ink.test.tsx`, antes de tocar `src/`): 2 fallos. «mientras se traza, la vista previa es un lienzo…»: `expected null not to be null` (no existe `[data-testid="ink-preview"]`; la capa aún pinta la `<polyline>`). «durante el trazo la capa no se vuelve a renderizar…»: `expected 100 to be +0` (commits = 100, uno por frame).
- Comandos ejecutados y resultado:
  - `pnpm --filter lector-pdf exec vitest run tests/ui/ink.test.tsx tests/unit/ink-preview.test.ts`: 17/17 en verde.
  - `pnpm --filter lector-pdf exec eslint --max-warnings 0 <ficheros cambiados>` y `pnpm lint` (raíz): código 0.
  - `pnpm --filter lector-pdf typecheck` y `pnpm typecheck` (raíz): código 0.
  - `pnpm test` (raíz): 145 ficheros, 1720 tests en verde, código 0.
  - `pnpm perf`: 25/25 en verde, código 0.
  - E2E acotado (`LECTOR_E2E_PORT=4191 LECTOR_E2E_OUTDIR=dist-ink-preview pnpm exec playwright test --project=chromium -g "ink|Dibujo|trazo"`): 15/15 en verde, código 0 (incluye `ink-preview.spec.ts` a 50 % y 300 %, y `ink.spec.ts`). No se ha ejecutado la batería completa.
  - Rendimiento: `uptime` antes de medir: `load average: 0.00, 0.41, 1.18` y `pgrep -fa "playwright|vitest|vite build"` vacío. `pnpm --filter lector-pdf exec playwright test --project=chromium-perf --no-deps --repeat-each=5 -g "trazo de 2 000"` (puerto 4191): 5 passed, código 0. Antes de medir había otra ejecución (PDF-074) en marcha; la espera al reposo se hizo con un bucle hasta que la carga bajó de 1.
  - `git diff`: sin `skip`, `.only`, `retries`, `waitForTimeout` ni cambios de umbrales.
- Dudas o cosas que no he podido hacer: ninguna de la ficha. Quedan fuera de mi commit `boveda/Apps/Lector PDF/Tareas/PDF-074-presupuesto-bundle-arranque.md` y los cambios de PDF-074 (`package.json`, `vite.config.ts`, `tests/bundle/`), que son del otro agente. El `Plan.md` sigue marcando PDF-076 como `pendiente`: lo actualiza el líder.
