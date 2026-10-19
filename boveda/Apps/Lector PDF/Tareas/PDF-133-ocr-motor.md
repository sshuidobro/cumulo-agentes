---
tipo: tarea
id: PDF-133
titulo: OCR - motor local tesseract.js, recursos empaquetados y escaneado de prueba
app: pdf
estado: pendiente
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
1. Dependencias (versiones exactas): `tesseract.js@7.0.0` y `tesseract.js-core@7.0.0` en `dependencies`; `@tesseract.js-data/spa@1.0.0`, `@tesseract.js-data/eng@1.0.0` y `@napi-rs/canvas@1.0.11` en `devDependencies` de `apps/lector-pdf`.
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
