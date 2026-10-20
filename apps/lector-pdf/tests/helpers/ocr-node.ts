import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createOcrEngineWithOptions, type OcrEngine, type OcrLanguage } from '../../src/engine/ocr.ts';

type SingleLanguage = Exclude<OcrLanguage, 'spa+eng'>;

/** Carpeta con `<lang>.traineddata.gz` de `@tesseract.js-data` (4.0.0_best_int), resuelta desde node_modules. */
function nodeLangPath(lang: SingleLanguage): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`)), '4.0.0_best_int');
}

/**
 * Motor OCR para Node (tests). Misma interfaz que `createOcrEngine`, pero las rutas son las de los
 * paquetes instalados: tesseract.js usa en Node su propio worker y su núcleo, y lee Buffers, no Blobs.
 */
export function createOcrEngineNode(lang: SingleLanguage): Promise<OcrEngine> {
  return createOcrEngineWithOptions(lang, {
    langPath: nodeLangPath(lang),
    gzip: true,
    cacheMethod: 'none',
    logger: () => undefined,
  }, async (image) => Buffer.from(await image.arrayBuffer()));
}
