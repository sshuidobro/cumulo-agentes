---
tipo: tarea
id: PDF-010
titulo: Dibujar las páginas en lienzo con la cola de render (cancelación y liberación de memoria)
app: pdf
estado: pendiente
depende_de: [PDF-009]
intentos: 0
skills: [stack-typescript-react, formatos-ofimatica, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, visor, render, rendimiento]
---

# PDF-010 · Render de páginas en lienzo

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Cada marco de página montado se dibuja con pdf.js en un `<canvas>` nítido (según `devicePixelRatio`, con límite de píxeles), con prioridad para las páginas visibles, cancelando lo que sale de pantalla y liberando la memoria de los lienzos desmontados. Las anotaciones existentes del PDF se ven (modo `ENABLE_STORAGE`).

## Contexto
- Leer: `src/core/render-queue.ts`, `canvas-size.ts` (PDF-007), `src/ui/viewer/Viewer.tsx`, `PageFrame.tsx` (PDF-009), `src/engine/page-dims.ts`, `src/state/document-actions.ts` (`reportPageDims`), [[ADR-0007-motor-y-visor-pdf]].
- API pdf.js 6: `page.getViewport({ scale, rotation })` (rotación **absoluta**: pasa `(page.rotate + rotaciónVista) % 360`), `page.render({ canvas, viewport, transform?, annotationMode, pageColors? })` devuelve `RenderTask` con `.promise` y `.cancel()`; cancelar rechaza con `RenderingCancelledException`.
- Con `exactOptionalPropertyTypes` no pases `transform: undefined`: construye el objeto de parámetros sin la clave.

## Qué hay que hacer
1. `src/engine/render.ts`:
   ```ts
   export interface RenderPageOptions {
     readonly scale: number; readonly rotation: Rotation; readonly outputScale: number; readonly signal: AbortSignal;
     readonly pageColors?: { readonly background: string; readonly foreground: string };
   }
   export async function renderPageToCanvas(page: PDFPageProxy, canvas: HTMLCanvasElement, o: RenderPageOptions): Promise<'done' | 'cancelled'>;
   ```
   `annotationMode: AnnotationMode.ENABLE_STORAGE`; `transform: [s,0,0,s,0,0]` solo si `outputScale !== 1`; si `signal` ya está abortada → `'cancelled'` sin renderizar; `signal` abortada durante → `task.cancel()`. `RenderingCancelledException` → `'cancelled'`; otros errores se relanzan.
2. `src/state/render-service.ts`: `export const renderQueue = new RenderQueue(2);` y `export function releaseCanvas(c: HTMLCanvasElement): void` (`c.width = 0; c.height = 0;`).
3. `src/ui/viewer/PageView.tsx` (sustituye a `PageFrame` dentro de `Viewer`; `PageFrame` queda como fondo/marcador dentro de `PageView`). Props: `{ index, numPages, top, left, width, height, zoom, rotation, visible: boolean }`.
   - Clave del trabajo `page:<index>`; prioridad `0` si `visible`, `1` si es *overscan*. Cambia prioridad con `setPriority` cuando cambia `visible`.
   - Al montar o cuando cambian `zoom`, `rotation`, `width`, `height`: `renderQueue.request({ key, priority, run })`. `run(signal)`: `page = await pdf.doc.getPage(index+1)`; `reportPageDims(await readPageDims(page))`; `plan = planCanvas(width, height, window.devicePixelRatio)`; lienzo **nuevo** con `plan.width/height` y CSS `width:100%;height:100%`; `renderPageToCanvas(page, canvas, { scale: zoomToScale(zoom), rotation, outputScale: plan.outputScale, signal })`; si `'done'` y el componente sigue montado con los mismos parámetros, sustituye el lienzo anterior (que se libera con `releaseCanvas`) y pone `data-rendered="true"` en el contenedor.
   - Mientras se dibuja el nuevo, el lienzo anterior sigue visible estirado (sin parpadeo al hacer zoom).
   - Al desmontar: `renderQueue.cancel(key)`, `releaseCanvas` del lienzo actual y `page.cleanup()` si se obtuvo la página.
   - Error que no es cancelación → mensaje en la página `msg.pageRenderFailed` («No se ha podido dibujar esta página.») + `createLogger('viewer').warn`; el resto de páginas sigue.
4. `Viewer.tsx`: pasa `visible` (dentro de `visibleRange` sin *overscan*) y usa `PageView`.
5. Tests: `tests/ui/page-view.test.tsx` (jsdom; `vi.mock` del motor con un `renderPageToCanvas` falso controlable y `getPage` falso) y `tests/e2e/render.spec.ts`.

## Criterios de aceptación
- [ ] (T) Montar 3 `PageView` visibles + 2 de *overscan* → los visibles se piden con prioridad 0 y los otros con 1; nunca hay más de 2 renders falsos en curso.
- [ ] (T) Desmontar una página con su render en curso aborta la señal y el lienzo se libera (`width === 0`).
- [ ] (T) Cambiar `zoom` mantiene el lienzo anterior en el DOM hasta que el nuevo termina; después solo hay **un** `<canvas>` en la página.
- [ ] (T) Si `renderPageToCanvas` rechaza con un error normal se muestra «No se ha podido dibujar esta página.» y otra página se dibuja igual.
- [ ] E2E: abrir `basic-5.pdf` → la página 1 tiene `data-rendered="true"` en < 1 s desde `setInputFiles`; captura de la página 1 a zoom 100 % igual a la referencia (`toHaveScreenshot`, `maxDiffPixelRatio: 0.01`; la referencia se genera la primera vez y se versiona).
- [ ] E2E: abrir `pages-5000.pdf` → página 1 dibujada en < 5 s; tras 20 saltos aleatorios con `End`/`Home`/rueda, `document.querySelectorAll('[data-testid=viewer] canvas').length ≤ 12` y `performance.memory.usedJSHeapSize < 400 MB` (anota el valor).
- [ ] E2E: `images-200.pdf` → recorrer las 20 primeras páginas con la rueda; todas las visibles acaban con `data-rendered="true"` y no hay *long tasks* > 100 ms en el hilo principal (anota la máxima).
- [ ] E2E: `annotated.pdf` → la página 1 se dibuja y la captura muestra el resaltado amarillo del fichero (comprobación visual de píxeles amarillos en la zona del `Rect` o captura de referencia).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Capa de texto (PDF-013), enlaces (PDF-014), modo noche (`pageColors`, PDF-020), lienzo de detalle (PDF-051).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
