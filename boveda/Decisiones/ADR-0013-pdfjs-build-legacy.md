---
tipo: decision
id: ADR-0013
app: pdf
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, pdf, motor, compatibilidad]
---

# ADR-0013 · Usar la build `legacy` de pdf.js también en navegador, worker y Tauri

## Contexto
[[PDF-008-abrir-documento]] quedó bloqueada: la build principal de `pdfjs-dist@6.4.299` (`build/pdf.mjs` y `build/pdf.worker.min.mjs`) llama a `Map.prototype.getOrInsertComputed` y `WeakMap.prototype.getOrInsertComputed` (propuesta ES reciente). El Chromium de `/opt/pw-browsers` (chromium-1194, Playwright 1.56.1) no lo tiene: `UnknownErrorException: this._requestsByChunk.getOrInsertComputed is not a function` y todo PDF aparece como «dañado». Inyectar un polyfill en la página no basta: el fallo también ocurre en el worker.
Los tests de Node ya usaban `pdfjs-dist/legacy/build/pdf.mjs` (alias de Vitest de [[PDF-001-esqueleto-app]]). Los webviews de Tauri ([[PDF-021-app-tauri]]: WebKitGTK en Linux, WKWebView en macOS, WebView2 en Windows) van por detrás de Chromium estable, así que el mismo fallo aparecería en escritorio con la build principal.
Base: [[ADR-0007-motor-y-visor-pdf]], [[Librerias y arquitectura PDF]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. Build `legacy` de pdfjs-dist en todas partes | Mismo paquete y versión; trae los polyfills (core-js) en la página **y** en el worker; un solo código para Node, navegador y Tauri | ~+65 KB el módulo principal (459 → 524 KB minificado) y ~+57 KB el worker (1 264 → 1 321 KB); algo más lento en teoría por los polyfills | Apache-2.0 |
| B. Polyfill propio o `core-js` como dependencia | Mantiene la build moderna | Hay que inyectarlo también en el worker (que pdf.js crea él mismo): exige envolver el worker; frágil ante cada versión de pdf.js | MIT |
| C. Actualizar Chromium de pruebas | Sin cambios de código | No es posible con `/opt/pw-browsers`; no arregla los webviews de Tauri ni navegadores del usuario algo antiguos | — |

## Decisión
**Opción A.** `src/engine/pdfjs.ts` y `src/engine/worker.ts` importan `pdfjs-dist/legacy/build/pdf.mjs` y `pdfjs-dist/legacy/build/pdf.worker.min.mjs?url`. Es el único punto que cambia (sigue siendo el único sitio que importa pdf.js, ADR-0007). Los recursos (`cmaps`, `standard_fonts`, `wasm`, `iccs`) son los mismos para ambas builds: `scripts/copy-pdfjs-assets.mjs` no cambia.
Comprobado por el líder el 2026-10-17 con el código de PDF-008: con el cambio, los 4 E2E de `tests/e2e/open.spec.ts` pasan en el Chromium de `/opt/pw-browsers` (100 000 páginas: prueba completa en 1,3 s) y `typecheck` y `eslint` de `src/engine` siguen en verde.

## Consecuencias
- Penalización aceptada: ~120 KB más de JavaScript en total (se descargan una vez, en local) y un coste de CPU de los polyfills no medible en las pruebas de apertura. Los presupuestos del [[Apps/Lector PDF/Plan|Plan]] no cambian; [[PDF-022-e2e-y-rendimiento-iteracion-1]] los vigila.
- Navegador, Tauri y Node ejecutan la misma build: un fallo que pase en un sitio pasa en todos.
- Los alias de Vitest (`vitest.config.ts` de la app y `vitest.perf.config.ts`) se mantienen: los tests de fixtures importan `pdfjs-dist` directamente.
- Al subir de versión pdf.js, probar si la build principal ya funciona en los webviews objetivo; volver a ella solo con otro ADR.
- La regla de lint `pdfjs-dist/*` ya cubre las rutas `legacy/...`: nada que cambiar.
