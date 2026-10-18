---
tipo: tarea
id: PDF-020
titulo: Tema claro/oscuro/sistema y modo noche de las páginas
app: pdf
estado: hecha
depende_de: [PDF-015]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, tema, accesibilidad]
---

# PDF-020 · Tema y modo noche

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0015-modo-noche-por-pixeles]] (modo noche) · [[ADR-0012-suite-de-rendimiento]] (prueba de rendimiento)

## Objetivo
Un menú «Apariencia» permite elegir el tema de la interfaz (Sistema, Claro, Oscuro) y activar el «Modo noche» de las páginas, que vuelve a dibujar el contenido del PDF con fondo oscuro y texto claro **sin invertir las imágenes**. Ambas opciones se recuerdan. La interfaz es legible en ambos temas y con escalado del sistema 125 % y 150 %.

## Contexto
- Leer: `src/ui/theme.css` (PDF-001), `src/engine/render.ts` (`pageColors`, PDF-010), `src/ui/viewer/PageView.tsx`, `src/ui/sidebar/Thumbnails.tsx`, `src/ui/toolbar/MainToolbar.tsx`.
- ~~pdf.js `render({ pageColors })` no toca las imágenes.~~ **Falso** en pdf.js 6.4.299 (las pasa a gris). Revisado 2026-10-18: el modo noche se hace transformando los píxeles del lienzo, ver [[ADR-0015-modo-noche-por-pixeles]] y la sección «Modo noche (revisado)». `pageColors` no se usa.
- Para el modo noche leer también: `src/engine/pdfjs.ts` (`OPS`, `AnnotationMode`), `tests/unit/engine-render.test.ts`, `tests/unit/fixtures.test.ts` (usa `getOperatorList` en Node), `tests/perf/measure.ts`.
- Patrón ARIA *menu button* (https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/).

## Qué hay que hacer
1. Store: `theme: 'system' | 'light' | 'dark'`, `nightMode: boolean`, cargados de `prefs` (`theme`, `nightMode`, con *guards*) al arrancar y guardados al cambiar. `src/state/appearance-actions.ts`: `setTheme(t)`, `toggleNightMode()`.
2. `src/ui/use-theme.ts`: aplica `document.documentElement.dataset.theme = 'light' | 'dark'` o lo elimina con `'system'`; pone `color-scheme` coherente (`light dark` en sistema). Llamado una vez en `App`.
3. `src/core/night.ts`: colores y algoritmo del modo noche (revisado: ver «Modo noche (revisado)», pasos N1–N2).
4. `PageView` y miniaturas: si `nightMode`, pasan `night: NIGHT_PAGE_COLORS` a `renderPageToCanvas` (ya no `pageColors`) y redibujan al cambiar; el marco de la página usa ese fondo mientras no hay lienzo (revisado: pasos N3–N4).
5. `src/ui/kit/MenuButton.tsx`: botón con `aria-haspopup="menu"` y `aria-expanded`; `role="menu"` con elementos `menuitemradio`/`menuitemcheckbox` (`aria-checked`); ↑/↓ entre elementos, Intro/Espacio activa, Esc cierra y devuelve el foco, clic fuera cierra. Reutilizable.
6. `MainToolbar`: menú «Apariencia» (`IconAppearance`) con «Tema: Sistema», «Tema: Claro», «Tema: Oscuro» (grupo de radio) y «Modo noche de las páginas» (casilla).
7. Revisión de `theme.css`: todos los colores de los componentes salen de variables; contraste ≥ 4,5:1 para texto y ≥ 3:1 para bordes de controles e iconos en ambos temas (anota los pares comprobados en el Registro); `rem` para tamaños de texto y controles.
8. Mensajes: `appearance` «Apariencia», `themeSystem` «Tema: Sistema», `themeLight` «Tema: Claro», `themeDark` «Tema: Oscuro», `nightMode` «Modo noche de las páginas».
9. Tests: `tests/ui/menu-button.test.tsx`, `tests/ui/appearance.test.tsx`, `tests/e2e/appearance.spec.ts`, más los del modo noche (paso N5).

## Modo noche (revisado 2026-10-18, [[ADR-0015-modo-noche-por-pixeles]])
pdf.js dibuja la página normal; después se transforman los píxeles del lienzo salvo los rectángulos de las imágenes. **Prohibido** usar `pageColors`, `ctx.filter`, filtros CSS sobre el lienzo o `recordImages`/`imageCoordinates`.

**N1. `src/core/night.ts`** (puro, sin pdf.js ni DOM). Exporta exactamente:
```ts
export interface NightColors { readonly background: string; readonly foreground: string } // '#rrggbb'
export const NIGHT_PAGE_COLORS = { background: '#1f1f23', foreground: '#e6e6e6' } as const satisfies NightColors;
/** Imagen que cubre al menos esta fracción del lienzo = página escaneada: se transforma como el resto. */
export const SCAN_COVERAGE = 0.85;
export type Matrix = readonly [number, number, number, number, number, number];
export interface PixelRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type PaintStep =
  | { readonly kind: 'save' }                       // apila la CTM
  | { readonly kind: 'restore' }                    // desapila; si la pila está vacía, se ignora
  | { readonly kind: 'transform'; readonly m: Matrix } // CTM = multiply(CTM, m)
  | { readonly kind: 'resetToBase' }                // CTM = base
  | { readonly kind: 'image'; readonly m: Matrix };    // imagen en el cuadrado unidad bajo multiply(CTM, m)
export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
export function multiply(a: Matrix, b: Matrix): Matrix;
export function applyMatrix(m: Matrix, x: number, y: number): readonly [number, number];
export function imageRects(steps: Iterable<PaintStep>, base: Matrix, canvasWidth: number, canvasHeight: number): PixelRect[];
export function parseHexColor(hex: string): readonly [number, number, number];
export function applyNightMode(data: Uint8ClampedArray, width: number, height: number, keep: readonly PixelRect[], colors?: NightColors): void;
```
- `multiply(a, b)` = `[a0*b0 + a2*b1, a1*b0 + a3*b1, a0*b2 + a2*b3, a1*b2 + a3*b3, a0*b4 + a2*b5 + a4, a1*b4 + a3*b5 + a5]` (aplica `b` primero; igual que `ctx.transform`). `applyMatrix(m, x, y)` = `[m0*x + m2*y + m4, m1*x + m3*y + m5]`.
- `imageRects`: CTM inicial = `base`, pila vacía. Por cada `image`: `M = multiply(CTM, step.m)`; transforma las 4 esquinas `(0,0) (1,0) (0,1) (1,1)`; `x0 = max(0, floor(minX))`, `y0 = max(0, floor(minY))`, `x1 = min(canvasWidth, ceil(maxX))`, `y1 = min(canvasHeight, ceil(maxY))`. Descarta si `x1 <= x0 || y1 <= y0` o si `(x1-x0)*(y1-y0) >= SCAN_COVERAGE * canvasWidth * canvasHeight`. Devuelve `{ x: x0, y: y0, width: x1-x0, height: y1-y0 }` en orden de aparición.
- `parseHexColor('#1f1f23')` → `[31, 31, 35]`. Formato distinto de `#rrggbb` → `throw new Error(...)` (es un bug, no un error esperable).
- `applyNightMode` (modifica `data` en el sitio; RGBA, `data.length === width*height*4`, si no → `throw`):
  1. Copia los píxeles de cada `keep` (fila a fila con `data.slice`) a búferes aparte.
  2. Tablas `lut[c][v] = Math.round(bg[c] + (fg[c] - bg[c]) * v / 255)` para `c ∈ {R,G,B}`, `v ∈ 0..255` (3 `Uint8Array(256)`), con `bg`/`fg` de `parseHexColor`.
  3. Por píxel: `d = 255 - max(r,g,b) - min(r,g,b)`; `r' = r + d`, `g' = g + d`, `b' = b + d` (inversión de luminosidad HSL, conserva el tono; quedan en 0..255); escribe `lutR[r'], lutG[g'], lutB[b']`. **Alfa sin cambios.**
  4. Vuelve a escribir los búferes de `keep` en su sitio.

**N2. `src/engine/night-ops.ts`** (único fichero que traduce pdf.js → `PaintStep`):
```ts
export interface OperatorListLike { readonly fnArray: ArrayLike<number>; readonly argsArray: ArrayLike<unknown> }
export function toPaintSteps(list: OperatorListLike): PaintStep[];
export function asMatrix(v: unknown): Matrix | null;
```
Tabla de traducción (`OPS` de `./pdfjs`; `args = list.argsArray[i]`, se trata como `unknown` y se estrecha; si un argumento no es válido, ese operador se ignora sin lanzar):

| Operador | Pasos |
|---|---|
| `OPS.save` / `OPS.restore` | `save` / `restore` |
| `OPS.transform` (`args` = 6 números) | `transform(args)` |
| `OPS.paintFormXObjectBegin` (`args[0]` = matriz o `null`) | `save` y, si hay matriz, `transform(args[0])` |
| `OPS.paintFormXObjectEnd` | `restore` |
| `OPS.beginGroup` / `OPS.endGroup` | `save` / `restore` |
| `OPS.beginAnnotation` (`args[2]` = transform, `args[3]` = matrix) | `save`, `resetToBase`, `transform(args[2])`, `transform(args[3])` |
| `OPS.endAnnotation` | `restore` |
| `OPS.paintImageXObject`, `OPS.paintInlineImageXObject` | `image(IDENTITY)` |
| `OPS.paintImageXObjectRepeat` (`args[1]` = scaleX, `args[2]` = scaleY, `args[3]` = posiciones `[x0,y0,x1,y1,…]`) | por cada par: `image([scaleX, 0, 0, scaleY, x, y])` |
| `OPS.paintInlineImageXObjectGroup` (`args[1]` = lista de `{ transform }`) | por cada elemento: `image(transform)` |
| Máscaras (`paintImageMask*`, `paintSolidColorImageMask`) y el resto | nada (son tinta: se transforman) |

`asMatrix` (exportado): acepta `Array` o `Float32Array`/`Float64Array` de longitud 6 con números finitos.

**N3. `src/engine/render.ts`**: en `RenderPageOptions` sustituye `pageColors` por `readonly night?: NightColors`. Nunca se pasa `pageColors` a pdf.js. Si `o.night` está definido:
```ts
// antes de await task.promise, para que pdf.js analice en paralelo:
const opsPromise = o.night ? page.getOperatorList({ intent: 'display', annotationMode: AnnotationMode.ENABLE_STORAGE }) : null;
// tras task.promise con éxito:
if (opsPromise && o.night) {
  const list = await opsPromise;
  if (o.signal.aborted) return 'cancelled';
  const vt = asMatrix(viewport.transform);
  if (vt === null) throw new Error('viewport sin matriz'); // bug
  const base = multiply([o.outputScale, 0, 0, o.outputScale, 0, 0], vt);
  const rects = imageRects(toPaintSteps(list), base, canvas.width, canvas.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('lienzo sin contexto 2d'); // bug
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  applyNightMode(img.data, canvas.width, canvas.height, rects, o.night);
  ctx.putImageData(img, 0, 0);
}
```
Si el dibujo se cancela, `opsPromise` no debe dejar un rechazo sin capturar: créalo con `.catch(() => null)` y trata `null` como «sin modo noche» (dibujo normal y `log.warn('no se ha podido aplicar el modo noche', { error })`, con `const log = createLogger('render')` de `@suite/shared`).

**N4. UI**: `PageView.tsx` y `ThumbnailItem.tsx` pasan `...(nightMode ? { night: NIGHT_PAGE_COLORS } : {})`. Actualiza el comentario de `NIGHT_PAGE_COLORS` y de `appearance-store.ts` (ya no hablan de pdf.js). `grep -rn pageColors apps/lector-pdf/src` sin resultados.

**N5. Tests nuevos o cambiados**: `tests/unit/night.test.ts` (core), `tests/unit/engine-night-ops.test.ts`, `tests/unit/engine-render.test.ts` (sustituir el caso de `pageColors`), `tests/ui/appearance.test.tsx` (esperar `night` en vez de `pageColors`), `tests/perf/night.perf.test.ts` (con `tests/perf/measure.ts`; nada de `performance.now()` en `tests/unit/`).

## Criterios de aceptación
- [ ] (T) `MenuButton`: abre con Intro y con clic, ↓ mueve el foco, Esc cierra y devuelve el foco al botón; `aria-checked` refleja el estado.
- [ ] (T) Elegir «Tema: Oscuro» → `<html data-theme="dark">` y `prefs.theme === 'dark'`; «Sistema» quita el atributo.
- [ ] (T) Activar modo noche hace que `PageView` pida un render nuevo con `night: NIGHT_PAGE_COLORS` (motor simulado); sin modo noche, ninguna llamada lleva `night`.
- [ ] (T) `multiply([2,0,0,2,0,0], [1,0,0,-1,0,842])` → `[2,0,0,-2,0,1684]`; `applyMatrix([1,0,0,-1,0,842], 97, 450)` → `[97, 392]`.
- [ ] (T) `imageRects([{kind:'image', m:[400,0,0,267,97,450]}], [1.5,0,0,-1.5,0,1263], 893, 1263)` → `[{ x: 145, y: 187, width: 601, height: 401 }]`.
- [ ] (T) `imageRects`: `save`, `transform([2,0,0,2,0,0])`, `restore`, `image(IDENTITY)` con base identidad → rect `{0,0,1,1}` (el `restore` deshace la escala); `restore` con pila vacía no lanza; `resetToBase` vuelve a `base`; con base identidad y lienzo 100×100: `image([0.7071068, 0.7071068, -0.7071068, 0.7071068, 10, 10])` (girada 45°) → `{ x: 9, y: 10, width: 2, height: 2 }`; `image([50,0,0,50,80,80])` → `{ x: 80, y: 80, width: 20, height: 20 }` (recortada); `image([90,0,0,100,0,0])` → ningún rect (escaneado) y `image([80,0,0,100,0,0])` → `{ x: 0, y: 0, width: 80, height: 100 }`.
- [ ] (T) `applyNightMode` con colores por defecto: blanco `(255,255,255)` → `(31,31,35)`; negro → `(230,230,230)`; rojo `(255,0,0)` → `(230,31,35)`; gris `(128,128,128)` → `(130,130,132)`; el alfa no cambia; los píxeles dentro de `keep` quedan idénticos; `data` de longitud incorrecta → lanza. `parseHexColor('#1f1f23')` → `[31,31,35]`; `parseHexColor('red')` lanza.
- [ ] (T) `toPaintSteps` con listas sintéticas cubre cada fila de la tabla de N2 (incluye `paintImageXObjectRepeat` con 2 posiciones → 2 `image`, una máscara → ningún paso, un `transform` con argumentos inválidos → ignorado).
- [ ] (T) Integración en Node: `images-200.pdf` página 1, `getOperatorList({ annotationMode: AnnotationMode.ENABLE_STORAGE })` → `imageRects(toPaintSteps(list), page.getViewport({ scale: 1 }).transform, 612, 792)` = `[{ x: 97, y: 75, width: 400, height: 267 }]` (corregido en la revisión: la página mide 612×792 y la imagen acaba en y = 450 + 267 = 717 pt, luego arriba = 792 − 717 = 75; el `595, 842, y: 125` original era un error de la ficha).
- [ ] (T) `renderPageToCanvas` con `night`: pdf.js recibe parámetros **sin** `pageColors`; se llama a `getOperatorList` con `annotationMode: AnnotationMode.ENABLE_STORAGE`; `putImageData` se llama una vez; si la señal aborta mientras se espera la lista de operadores → `'cancelled'` y no hay `putImageData`; sin `night` no se llama a `getOperatorList`.
- [ ] Rendimiento (`pnpm perf`): `applyNightMode` sobre 2 000 000 píxeles con un rectángulo `keep` de 400×267 < 100 ms (mediana según `measure.ts`).
- [ ] `grep -rn "pageColors" apps/lector-pdf/src` sin resultados.
- [ ] E2E: con `colorScheme: 'dark'` del navegador y tema «Sistema», el fondo de la barra es oscuro (color calculado con luminancia < 0,2); con «Claro» es claro.
- [ ] E2E: `images-200.pdf` con modo noche → el fondo de la página 1 es oscuro (píxel de la esquina) y la imagen conserva sus colores (píxel dentro de la imagen igual que sin modo noche, tolerancia 10 por canal). El test ya escrito en `tests/e2e/appearance.spec.ts` se mantiene **sin cambiar el criterio**.
- [ ] E2E: con modo noche, la miniatura de la página 1 también tiene la esquina oscura.
- [ ] E2E: tras recargar, tema y modo noche se mantienen.
- [ ] E2E: con `deviceScaleFactor: 1.5` y ventana 1280×800 la barra no se corta ni se solapa (todos los botones visibles) y el lienzo de la página 1 mide `≈ 1,5 ×` su tamaño CSS (nitidez).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Colores personalizados de página, alto contraste del sistema (`forced-colors`), más idiomas.
- Modo noche en impresión y exportación (siempre se imprime normal).
- Precisión de imágenes giradas o con transparencia: se conserva su rectángulo envolvente tal cual (limitación aceptada en [[ADR-0015-modo-noche-por-pixeles]]).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/core/appearance.ts`, `src/core/night.ts`, `src/state/appearance-store.ts`, `src/state/appearance-actions.ts`, `src/ui/use-theme.ts`, `src/ui/kit/MenuButton.tsx` y `MenuButton.module.css`, `tests/ui/menu-button.test.tsx`, `tests/ui/appearance.test.tsx`, `tests/e2e/appearance.spec.ts`. Modificados (cambios puntuales): `src/ui/icons.tsx` (`IconAppearance`), `src/ui/messages.ts`, `src/ui/toolbar/MainToolbar.tsx`, `src/ui/App.tsx`, `src/main.tsx`, `src/ui/viewer/PageView.tsx`, `PageFrame.tsx`, `Viewer.module.css`, `src/ui/sidebar/ThumbnailItem.tsx`, `Sidebar.module.css`, `src/ui/theme.css`, `src/ui/toolbar/ZoomControls.module.css`, `PageNavigator.module.css`, `src/ui/search/SearchBar.module.css`, `tests/ui/open.test.tsx` (ajuste del orden de Tab, ver abajo).
- Qué he hecho: menú «Apariencia» (`MenuButton` reutilizable, ARIA menu button) con Tema Sistema/Claro/Oscuro y «Modo noche de las páginas»; tema aplicado a `<html>` con `data-theme` y `color-scheme`; preferencias `theme` y `nightMode` con guards, cargadas al arrancar. Modo noche: `PageView` y miniaturas redibujan con `pageColors: NIGHT_PAGE_COLORS`; el marco usa el fondo oscuro. Revisión de `theme.css`: papel y texto de página en variables, nueva `--color-control-border` para bordes de controles.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 1470/1470 OK (el único fallo intermedio, `open.test.tsx` Tab, lo causó el botón nuevo y se ajustó); `pnpm coverage` OK (All files 96,76 % líneas). E2E con config temporal en puerto 4410 (`pw-all.config.ts` en el scratchpad): 79 pasan y 1 falla: `appearance.spec.ts` «modo noche… conservan sus colores». Tests de la ficha: T-menú (`MenuButton`), T-tema, T-modo noche con `pageColors` y E2E de tema según el sistema, tras recargar y escalado 1,5 × con barra completa: todos en verde.
- Contrastes comprobados (WCAG): claro: texto #1d1d1f sobre #f5f5f7 15,5 / #fff 16,8 / #e8e8ed 13,8; muted #55555c sobre #e8e8ed 6,1 y sobre #d1d1d6 4,9; acento #0a58ca sobre #fff 6,4; texto de acento #fff sobre acento 6,4; peligro #b3261e sobre #fff 6,5; borde de control #76767c sobre #f5f5f7 4,2; número de página #55555c sobre #fff 7,4. Oscuro: texto #f2f2f7 sobre #1c1c1e 15,3 / #2c2c2e 12,5 / #3a3a3c 10,2; muted #aeaeb2 sobre #2c2c2e 6,3 / #3a3a3c 5,1; acento #4da3ff sobre #2c2c2e 5,3; texto de acento #002b52 sobre acento 5,5; peligro #ff8a80 sobre #2c2c2e 6,1; borde de control #8e8e93 sobre #2c2c2e 4,3; número en noche #c7c7cc sobre #1f1f23 9,8. Todos ≥ 4,5 (texto) y ≥ 3 (controles).
- Dudas o cosas que no he podido hacer:
  1. **Bloqueo (decisión de producto/diseño):** la ficha dice que `pageColors` «no toca las imágenes». Falso en pdf.js 6.4.299: `#drawFilter` (pdf.mjs, ~línea 11066) vuelve a dibujar **todo el lienzo** con un filtro HCM que asigna brillo a un degradado entre el color de texto y el de fondo. Resultado medido: la imagen de `images-200.pdf` pasa de colores (p. ej. 215/48/37) a gris (diferencia de 225 en un canal). El criterio E2E «la imagen conserva sus colores (tolerancia 10)» no se puede cumplir con `pageColors` tal como está especificado. No lo he resuelto por mi cuenta porque cambiaría el diseño. Opciones a decidir por el líder: (a) aceptar que el modo noche convierte imágenes a gris y cambiar el criterio; (b) otro mecanismo que preserve imágenes (p. ej. filtro CSS sobre el lienzo más compensación de imágenes), que requiere diseño y un ADR. Capturas: `scratchpad/normal.png` (normal) y `pw-results` (noche).
  2. El test E2E de imagen **no está saltado ni modificado**: queda en rojo a propósito hasta que se decida 1.
  3. `tests/ui/open.test.tsx`: el segundo Tab de «se puede llegar a los botones con el teclado» ahora cae en «Apariencia» (siempre activo); he añadido ese paso y se mantiene la comprobación de «Abrir…» del visor. Lo señalo por si el revisor quiere otra solución.
  4. Sin commit: el árbol de trabajo tiene cambios de otros agentes sin confirmar; no he hecho git commit/stash/checkout, como se pidió.
  5. Pendiente de la ficha: `pnpm --filter lector-pdf e2e` con código 0 no se cumple mientras esté el bloqueo 1; el resto de criterios sí.

### [lider] replanificación — 2026-10-18
- Bloqueo resuelto (decisión técnica, no de producto): [[ADR-0015-modo-noche-por-pixeles]]. `pageColors` queda descartado; el modo noche transforma los píxeles del lienzo tras el render y conserva los rectángulos de las imágenes, calculados con `getOperatorList()` (API pública). Las fotos a página completa (≥ 85 %, escaneados) sí se transforman.
- El criterio E2E de la imagen **no se relaja**: el test rojo de la ronda 1 debe pasar con el nuevo mecanismo.
- Cambios en la ficha: Contexto corregido, pasos 3–4 remiten a la nueva sección «Modo noche (revisado)» (N1–N5, con firmas, tabla de operadores y pseudocódigo de `render.ts`), criterios nuevos con valores exactos y dos exclusiones nuevas en «Fuera de alcance».
- Lo ya hecho en la ronda 1 (tema, `MenuButton`, preferencias, contrastes) sigue valiendo; solo cambia el modo noche. El ajuste de `tests/ui/open.test.tsx` (Tab que cae en «Apariencia») es correcto: se mantiene.
- Estado → `cambios-pedidos`, `intentos: 0`.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/engine/night-ops.ts`, `tests/unit/night.test.ts`, `tests/unit/engine-night-ops.test.ts`, `tests/perf/night.perf.test.ts`. Reescritos: `src/core/night.ts` (N1), `src/engine/render.ts` (N3, `night` en vez de `pageColors`), `tests/unit/engine-render.test.ts`. Cambios puntuales: `src/ui/viewer/PageView.tsx` y `src/ui/sidebar/ThumbnailItem.tsx` (`night: NIGHT_PAGE_COLORS`), `src/state/appearance-store.ts` (comentario), `tests/ui/appearance.test.tsx` (`night`), `tests/e2e/appearance.spec.ts` (nuevo E2E de la miniatura). `grep -rn pageColors apps/lector-pdf/src` sin resultados.
- Qué he hecho: modo noche por píxeles según ADR-0015 y N1–N5. `core/night.ts` (matrices, `imageRects`, `applyNightMode` con tablas por canal); `engine/night-ops.ts` traduce `getOperatorList` a pasos de pintado; `renderPageToCanvas` pide la lista en paralelo, transforma el lienzo tras el dibujo y conserva las imágenes; `PageView` y miniaturas pasan `night`. Ya no se usa `pageColors`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 1510/1510 OK; `pnpm coverage` OK (All files 96,86 % líneas; `core/night.ts` 100 % líneas); `pnpm --filter lector-pdf e2e` 82/82 OK, código 0 (incluye `appearance.spec.ts`: el criterio de la imagen de `images-200.pdf` pasa, con tolerancia 10, y el nuevo E2E de la miniatura); `pnpm perf`: `night.perf` OK (applyNightMode sobre 2 000 000 px con un rectángulo de 400×267 < 100 ms). En la primera ejecución completa de `pnpm perf` falló `annotation-layer.perf.test.ts` (102,3 ms frente a 100 ms, montar 500 anotaciones); en solitario pasa. No es código de esta ficha.
- Dudas o cosas que no he podido hacer:
  1. **Criterio de integración inconsistente con el fichero.** La ficha pide `imageRects(..., 595, 842) = { x: 97, y: 125, … }`. `images-200.pdf` tiene la página de 612×792 (viewport `[1,0,0,-1,0,792]`) y la imagen en `y0 = 450`, alto 267: el borde superior queda en `y = 75`. Con esa geometría, `y = 125` solo sale de una página de 842 pt de alto. He puesto el test con el tamaño real (612×792) y `y: 75`, con un comentario que lo explica. El líder debe confirmar que la cifra de la ficha era un error y no un tamaño de página que se quería usar.
  2. `toPaintSteps`: la ficha dice que un argumento inválido «ignora ese operador», pero eso desequilibraría `save`/`restore`. He mantenido el `save` y el `restore` siempre y omito solo la matriz inválida (`paintFormXObjectBegin` y `beginAnnotation`). Lo indico por si el revisor quiere otra cosa.
  3. El `log.warn` de «sin modo noche» no lleva el error original, porque `opsPromise` se crea con `.catch(() => null)` tal como pide N3.
  4. No he hecho commit: lo pediste así y el árbol tiene cambios de PDF-038 y otros sin confirmar.
  5. La salida de `pnpm test` muestra «Not implemented: HTMLCanvasElement's getContext()» de jsdom. No viene de la ruta del modo noche (los tests de UI mockean `renderPageToCanvas` y los unitarios usan lienzos falsos). No he comprobado si ya aparecía antes de esta ronda.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Comprobado: `pnpm lint`, `pnpm typecheck` OK; `pnpm test` 1528/1528; `pnpm perf` 21/21 (incluye `night.perf`); `playwright test appearance` 5/5 (imagen conservada, miniatura, recarga, 1,5 ×, tema del sistema). `grep pageColors src` vacío. `core/night.ts` y `engine/night-ops.ts` coinciden con N1/N2; `render.ts` con N3 (`.catch(() => null)`, cancelación sin `putImageData`).
- Nota sobre y:125 vs 75: **el error era de la ficha**. `images-200.pdf` tiene página 612×792 (viewport `[1,0,0,-1,0,792]`); la imagen va de y=450 a 717 pt, así que arriba = 792 − 717 = 75. Con 842 de alto saldría 125, pero ese no es el tamaño de la página. Criterio de integración corregido en la ficha a `612, 792` y `y: 75`; el test del programador es correcto.
- Desviación del programador en `toPaintSteps` (mantener `save`/`restore` y omitir solo la matriz inválida): correcta, mantiene las pilas equilibradas. Aceptada.
- (opcional) `render.ts:61` el aviso de log no incluye la causa real porque `.catch(() => null)` la descarta; aceptable por lo que pide N3.
- (opcional) El aviso de jsdom «Not implemented: getContext» en `pnpm test` conviene investigarlo aparte; no bloquea.
- Contrastes anotados en la ronda 1 revisados: todos ≥ 4,5 (texto) y ≥ 3 (controles). 0 problemas bloqueantes.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| lint / typecheck | OK | `pnpm lint`, `pnpm typecheck` código 0 |
| `pnpm test` | OK | 128 ficheros, 1528/1528 (incluye menu-button, appearance, night, engine-night-ops, engine-render) |
| `pnpm coverage` | OK | All files 96,86 % líneas |
| `pnpm perf` | OK | 14 ficheros, 21/21 (`night.perf`: 2 M px con keep 400×267 < 100 ms) |
| E2E `pnpm --filter lector-pdf e2e` | OK | 82/82 (tema sistema/claro, imagen conservada en modo noche, miniatura, recarga, 1,5 ×) |
| `grep -rn pageColors src` | OK | sin resultados |
| Criterios (T) de matrices, `imageRects`, `applyNightMode`, `toPaintSteps`, `renderPageToCanvas` | OK | cubiertos por tests unitarios en verde |

Tests añadidos: `apps/lector-pdf/tests/unit/night-qa.test.ts` (lienzo 0×0, `keep` solapados, imagen fuera del lienzo).
Rendimiento: `applyNightMode` dentro de presupuesto según `night.perf`. Sin fallos.
