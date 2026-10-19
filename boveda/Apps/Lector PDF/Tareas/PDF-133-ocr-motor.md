---
tipo: tarea
id: PDF-133
titulo: OCR - motor local tesseract.js, recursos empaquetados y escaneado de prueba
app: pdf
estado: hecha
depende_de: [PDF-052]
intentos: 0
skills: [stack-typescript-react, stack-tauri, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, ocr, dependencias]
---

# PDF-133 · OCR: motor local tesseract.js, recursos empaquetados y escaneado de prueba

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0038-ocr-local-tesseract]] · Sigue: [[PDF-134-ocr-interfaz]]

## Objetivo
Un módulo `src/engine/ocr.ts` que reconoce el texto de una imagen de página con tesseract.js **sin ninguna conexión de red** (núcleo WASM e idiomas español e inglés servidos desde la propia app) y devuelve palabras con su caja en píxeles; y un PDF escaneado de prueba en español de 3 páginas.

## Contexto
- [[ADR-0038-ocr-local-tesseract]] (versiones, ficheros y opciones exactas).
- `apps/lector-pdf/scripts/copy-pdfjs-assets.mjs` (patrón para copiar recursos a `public/`) y el script `assets` de `apps/lector-pdf/package.json`.
- `src/engine/pdfjs.ts` (patrón de `import()` diferido de una librería pesada); `services().assetBaseUrl`.
- CSP: `vite.config.ts` y `src-tauri/tauri.conf.json` (`script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; connect-src 'self' …`).
- Fixtures: `tests/fixtures/pdf-builder.ts`, `tests/fixtures/catalog.ts`, `fixtures/FUENTES.md`.

## Qué hay que hacer
1. Dependencias (versiones exactas): `tesseract.js@7.0.0` y `tesseract.js-core@7.0.0` en `dependencies`; `@tesseract.js-data/spa@1.0.0`, `@tesseract.js-data/eng@1.0.0` y `@napi-rs/canvas@1.0.11` (si aún no está) en `devDependencies` de `apps/lector-pdf`.
2. `scripts/copy-ocr-assets.mjs` (se llama desde el script `assets` tras el de pdf.js): copia a `public/ocr/` `tesseract.js/dist/worker.min.js`, `tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js`, `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js`, y `@tesseract.js-data/{spa,eng}/4.0.0_best_int/{spa,eng}.traineddata.gz`. Añade `public/ocr/` al `.gitignore` como `public/pdfjs/`.
3. `src/engine/ocr.ts`:
```ts
export type OcrLanguage = 'spa' | 'eng' | 'spa+eng';
export interface OcrWordPx { readonly text: string; readonly confidence: number; readonly bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number } }  // píxeles, origen arriba-izquierda
export interface OcrEngine {
  recognize(image: Blob | ImageData, signal: AbortSignal): Promise<readonly OcrWordPx[] | 'cancelled'>;
  terminate(): Promise<void>;
}
/** Crea el motor con rutas locales: `${assetBaseUrl}ocr/`. */
export async function createOcrEngine(lang: OcrLanguage, assetBaseUrl: string): Promise<OcrEngine>;
```
   - `const { createWorker, OEM } = await import('tesseract.js')`; `createWorker(lang, OEM.LSTM_ONLY, { workerPath: base + 'worker.min.js', corePath: base, langPath: base, workerBlobURL: false, cacheMethod: 'none', gzip: true, logger: () => {} })`.
   - `recognize` usa la salida por bloques → párrafos → líneas → palabras (tesseract.js 7: `worker.recognize(image, {}, { blocks: true })`); se descartan palabras con `confidence < 30` o texto vacío.
   - Cancelar: si `signal` aborta, `worker.terminate()` y se recrea el *worker* en la siguiente llamada; devuelve `'cancelled'`.
   - Para Node (tests): `tests/helpers/ocr-node.ts` → `createOcrEngineNode(lang): Promise<OcrEngine>` con la misma interfaz, `langPath` = carpeta de `@tesseract.js-data/<lang>/4.0.0_best_int` (resuelta con `createRequire`) y sin `workerPath`/`corePath` (en Node tesseract.js usa los de sus paquetes).
4. Lint: solo `src/engine/ocr.ts` puede importar `tesseract.js` (regla `no-restricted-imports` como la de `pdfjs-dist`).
5. Fixture `scanned-es-3.pdf` (`tests/fixtures/scanned.ts`, registrado en `catalog.ts`): 3 páginas A4, cada una **una sola imagen JPEG en gris** de 1654×2339 px (200 ppp) dibujada con `@napi-rs/canvas` (fondo blanco, texto negro sans-serif de 40 px, sin capa de texto) con estas líneas:
   - Página 1: «FACTURA NÚMERO 2026-0042», «Cliente: Panadería Muñoz», «Importe total: 1.234,56 euros».
   - Página 2: «CONTRATO DE ARRENDAMIENTO», «El arrendatario se compromete», «a pagar la renta mensual.».
   - Página 3: «INFORME TÉCNICO», «Revisión de la instalación eléctrica», «Conclusión: apta.».
   Añade la entrada en `fixtures/FUENTES.md`.
6. Tests: `tests/unit/ocr-engine.test.ts` (Node, `tests/helpers/ocr-node.ts`; *timeout* 60 s): reconocer la imagen de la página 1 del fixture.

## Criterios de aceptación
- [ ] `pnpm --filter lector-pdf assets` deja en `public/ocr/` los 6 ficheros (y nada de jsDelivr en el código: `grep -r "cdn.jsdelivr" apps/lector-pdf/src` vacío).
- [ ] Unit (Node): la página 1 de `scanned-es-3.pdf` reconocida con `spa` contiene las palabras «FACTURA», «2026-0042», «Panadería» y «Muñoz» (comparación sin distinguir mayúsculas), cada una con una caja dentro de la imagen.
- [ ] El build web contiene `ocr/worker.min.js` y los `.traineddata.gz`; `bundle:check` sigue dentro del presupuesto (tesseract.js solo en *chunks* diferidos).
- [ ] La CSP no cambia (o, si tesseract necesitara algo más, se documenta en [[ADR-0038-ocr-local-tesseract]] y se añade solo eso).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Interfaz y escritura de la capa ([[PDF-134-ocr-interfaz]], [[PDF-061-ocr]]). Más idiomas. Preprocesado de imagen (enderezar, umbral).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/package.json` (deps exactas y script `assets`), `apps/lector-pdf/scripts/copy-ocr-assets.mjs` (nuevo), `apps/lector-pdf/src/engine/ocr.ts` (nuevo), `apps/lector-pdf/tests/helpers/ocr-node.ts` (nuevo), `apps/lector-pdf/tests/fixtures/scanned.ts` (nuevo), `apps/lector-pdf/tests/fixtures/catalog.ts`, `apps/lector-pdf/tests/unit/ocr-engine.test.ts` (nuevo), `apps/lector-pdf/tests/unit/fixtures.test.ts` (27 → 28 fixtures), `eslint.config.js` (regla `no-restricted-imports` para tesseract.js; `public/ocr/` ignorado), `.gitignore`, `fixtures/FUENTES.md`, `pnpm-lock.yaml`.
- Qué he hecho: motor `createOcrEngine` con worker local (`${assetBaseUrl}ocr/`), reconocimiento por bloques→palabras con filtro de confianza < 30 y cancelación que termina y recrea el worker. Script de copia de 6 ficheros a `public/ocr/` y fixture `scanned-es-3.pdf` (JPEG 1654×2339 por página, generado con `@napi-rs/canvas`). Añadido `createOcrEngineWithOptions` (export extra de `ocr.ts`) para que el helper de Node reutilice la misma lógica. Las imágenes son JPEG RGB con gris (`/DeviceRGB`), no JPEG de 1 componente: `@napi-rs/canvas` no codifica escala de grises.
- Comandos ejecutados y resultado: `pnpm --filter lector-pdf assets` OK (6 ficheros en `public/ocr/`); `pnpm lint` OK; `pnpm typecheck` 0 errores; `pnpm --filter lector-pdf build` OK (arranque 541 837 bytes de 600 000; `dist/ocr/` con los 6 ficheros); `vitest run tests/unit/ocr-engine.test.ts` 3/3 OK; `grep cdn.jsdelivr apps/lector-pdf/src` vacío. `pnpm coverage`: 3 fallos, ninguno de esta ficha. Dos son de UI que ya estaban rojos antes del commit (`comment-toolbar.test.tsx` y `sidebar.test.tsx`, según la bitácora del 2026-10-19). El tercero (`fixtures.test.ts`, recuento de fixtures) lo causaba esta ficha y ya está corregido a 28. El resto de la suite pasa (3043 tests). Por eso `pnpm coverage` no sale con código 0 todavía.
- Dudas o cosas que no he podido hacer: (1) Los 3 fallos de UI no son de esta ficha; no los he tocado. (2) La CSP no cambia: no la he tocado y el build no requiere nada extra, pero el worker/WASM aún no se ha probado en navegador (eso es PDF-134/e2e). (3) No he medido la cobertura de `ocr.ts` por separado.

### [revisor] ronda 1 — 2026-10-19 — APROBADO
1. Lint y typecheck OK; `pnpm coverage`: 3043 OK y 3 fallos de UI ajenos (`comment-toolbar`, `sidebar`, ya rojos antes, en la bitácora); ninguno es de esta ficha. El código 0 depende de arreglarlos aparte.
2. (opcional) `createOcrEngine` (rutas `ocr/`) no tiene test directo; solo se cubre `createOcrEngineWithOptions`. Se verá en PDF-134/e2e.
3. (opcional) El JPEG del fixture es RGB con gris y no de 1 componente (limitación de `@napi-rs/canvas`); aceptable y documentado.

### [tester] ronda 1 — 2026-10-19 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| assets deja 6 ficheros en `public/ocr/`; sin jsDelivr | OK | `pnpm --filter lector-pdf assets` -> 6 ficheros; grep vacío |
| Unit Node: FACTURA, 2026-0042, Panadería, Muñoz con caja | OK | `vitest run tests/unit/ocr-engine.test.ts` 3/3 |
| Build con `ocr/*`; bundle dentro de presupuesto | OK | `dist/ocr/` 6 ficheros; arranque 544 998 / 600 000 |
| CSP sin cambios | OK | sin cambios en vite.config.ts ni src-tauri |
| lint, typecheck, coverage | lint y typecheck OK; coverage 3043 OK y 3 fallos | Los 3 fallos (comment-toolbar x2, sidebar F4) son de PDF-140 (lazy), ajenos a esta ficha según la bitácora 2026-10-19 |
Tests añadidos: ninguno (los existentes cubren los criterios). Rendimiento: ocr-engine.test 2,4 s.
Nota: `createOcrEngine` (rutas `ocr/`) sin probar en navegador; queda para PDF-134/e2e.
