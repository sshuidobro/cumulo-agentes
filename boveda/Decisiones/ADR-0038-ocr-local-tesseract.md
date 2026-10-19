---
tipo: decision
id: ADR-0038
app: pdf
estado: aceptada
fecha: 2026-10-19
creado: 2026-10-19
actualizado: 2026-10-19
tags: [decision, pdf, ocr, dependencias]
---

# ADR-0038 · OCR local con tesseract.js y datos de idioma empaquetados

## Contexto
[[PDF-061-ocr|PDF-061]]: reconocer texto en escaneados y añadir una capa de texto invisible. Requisito del proyecto: ningún dato sale del ordenador. Investigación: [[Paridad Adobe Acrobat]] §11 (tesseract.js 7.0.0, Apache-2.0).
Comprobado con `npm view` y `npm pack` (2026-10-19): `tesseract.js` 7.0.0 (Apache-2.0, depende de `tesseract.js-core` ^7), `tesseract.js-core` 7.0.0 (Apache-2.0; variantes `tesseract-core-{relaxedsimd-,simd-,}lstm.wasm.js` de ~3,9 MB con el WASM embebido), `@tesseract.js-data/spa` y `@tesseract.js-data/eng` 1.0.0 (MIT; `4.0.0_best_int/<lang>.traineddata.gz`, ~2,1 MB el español). Por defecto tesseract.js descarga el núcleo y los idiomas de jsDelivr: hay que darle rutas locales.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| **A. tesseract.js con núcleo e idiomas copiados a `public/ocr/`** | Local, en Worker propio de tesseract, mismo código en web y Tauri | ~14 MB más en la app (3 variantes del núcleo + 2 idiomas) | Apache-2.0 / MIT |
| B. Tesseract nativo por comando Rust | Más rápido | Solo escritorio; instalar Tesseract en el sistema del usuario | Apache-2.0 |
| C. Servicio en la nube | Mejor precisión | Prohibido: los documentos saldrían del equipo | — |

## Decisión
**Opción A.** Dependencias: `tesseract.js@7.0.0` y `tesseract.js-core@7.0.0` (`dependencies`), `@tesseract.js-data/spa@1.0.0` y `@tesseract.js-data/eng@1.0.0` (`devDependencies`: solo se copian sus ficheros). Idiomas: **español e inglés** (se pueden combinar `spa+eng`).
- `scripts/copy-ocr-assets.mjs` copia a `public/ocr/`: `worker.min.js`, las tres variantes `*-lstm.wasm.js` y `spa`/`eng` `.traineddata.gz` de `4.0.0_best_int`.
- `createWorker(langs, OEM.LSTM_ONLY, { workerPath, corePath, langPath, workerBlobURL: false, cacheMethod: 'none' })` con rutas bajo `assetBaseUrl + 'ocr/'`. Ninguna URL externa.
- Solo `src/engine/ocr.ts` importa `tesseract.js` (como pdf.js en `engine/`), con `import()` diferido.
- Capa de texto: Helvetica WinAnsi en modo invisible (`3 Tr`) dentro de un incremento ([[ADR-0036-anadir-contenido-aplanando]], `page-content.ts`).

## Consecuencias
- La app crece ~14 MB; el arranque no (todo diferido).
- Calidad de reconocimiento: la de Tesseract LSTM «best_int»; texto no latino fuera de WinAnsi sale como «?» en la capa.
- El e2e comprueba que no hay peticiones de red fuera del origen local durante el OCR.
