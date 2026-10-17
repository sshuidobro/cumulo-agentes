---
tipo: tarea
id: PDF-010
titulo: Dibujar las páginas en lienzo con la cola de render (cancelación y liberación de memoria)
app: pdf
estado: en-revision
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

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/engine/render.ts` (nuevo), `src/state/render-service.ts` (nuevo), `src/ui/viewer/PageView.tsx` (nuevo), `src/ui/viewer/PageFrame.tsx` (props `rendered` y `children`), `src/ui/viewer/Viewer.tsx` (usa `PageView` y pasa `zoom`, `rotation` y `visible`), `src/ui/viewer/Viewer.module.css`, `src/ui/messages.ts` (`pageRenderFailed`), `tests/ui/page-view.test.tsx` (nuevo), `tests/unit/engine-render.test.ts` (nuevo), `tests/ui/open.test.tsx` (la página falsa ahora tiene `getViewport`, `render` y `cleanup`), `tests/e2e/render.spec.ts` (nuevo) y su referencia `tests/e2e/render.spec.ts-snapshots/basic-5-pagina-1-zoom-100-chromium-linux.png`.
- Qué he hecho: `renderPageToCanvas` dibuja con pdf.js (`ENABLE_STORAGE`, `transform` solo si la densidad no es 1) y se cancela con la señal. `PageView` pide el dibujo a la cola compartida (2 a la vez; visibles prioridad 0, overscan 1), dibuja en un lienzo nuevo, lo sustituye al terminar y libera el anterior. Al desmontar cancela, libera lienzos y llama a `page.cleanup()`. Un error normal muestra «No se ha podido dibujar esta página.» y se registra con `createLogger('viewer')`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `vitest run` en lector-pdf 48 ficheros / 611 tests OK; `playwright test tests/e2e/render.spec.ts` 5/5 OK. Cobertura de `PageView.tsx`: 100 % líneas, 95 % sentencias (con `coverage/` del repo ocupado por otro proceso, usé un directorio propio). Medidas (anotadas en el test): primera página de `basic-5` 469 ms; de `pages-5000` 468 ms; heap JS tras 20 saltos 11,2 MB; tarea larga máxima en `images-200` 52 ms; píxeles amarillos del resaltado en `annotated` 12 540.
- **Pendiente, no es de esta ficha:** `pnpm --filter lector-pdf e2e` NO sale con código 0. Fallan 2 de 26 tests:
  1. `tests/e2e/viewer.spec.ts` «en sizes-mixed…» (PDF-009): la app se cae con «Maximum update depth exceeded» al hacer scroll hasta la página 5. Lo he reproducido en el commit `1dbc998` (PDF-009), sin mis cambios. Causa encontrada: en `Viewer.tsx` el zoom automático (y de ajuste) usa `currentPage`; el zoom cambia el layout, el layout cambia la página actual y así en bucle al haber páginas de distinto tamaño. Comprobado: fijar el zoom a la página 0 elimina el bucle. Propuesta: devolver PDF-009 a `cambios-pedidos` (no lo he tocado, está fuera de mi alcance).
  2. `tests/e2e/viewer-stress.spec.ts` (fichero sin commit de otro agente, pages-5000): «element(s) not found». No lo he investigado.
- Dudas o cosas que no he podido hacer:
  1. `RenderPageOptions.rotation` es la rotación **absoluta** del viewport, según la nota de la ficha; `PageView` la calcula como `(page.rotate + rotación de vista) % 360`.
  2. El criterio «zoom 100 %» no se puede fijar desde la interfaz (no hay control de zoom hasta PDF-011). El test ajusta el ancho de la ventana y comprueba que el marco mide 816 px antes de capturar.
  3. `PageFrame` recibe `rendered` y `children` para alojar el lienzo; la ficha no lo especificaba, pero mantiene el marco como fondo.
  4. El árbol de trabajo era compartido: otros agentes commitearon PDF-026 y PDF-030 durante mi trabajo. Solo he commiteado mis ficheros.
