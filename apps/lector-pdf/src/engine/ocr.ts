// Único punto del proyecto que importa tesseract.js (ADR-0038). Carga diferida: el motor no entra en el arranque.
// Todo se sirve desde la propia app (public/ocr/): ninguna petición de red.
import type { Page, Worker, WorkerOptions } from 'tesseract.js';

export type OcrLanguage = 'spa' | 'eng' | 'spa+eng';

/** Palabra reconocida. Coordenadas en píxeles de la imagen, origen arriba-izquierda. */
export interface OcrWordPx {
  readonly text: string;
  readonly confidence: number;
  readonly bbox: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
}

export interface OcrEngine {
  /** Reconoce el texto de una imagen. Si `signal` aborta antes de terminar, descarta el worker y devuelve `'cancelled'`. */
  recognize(image: Blob | ImageData, signal: AbortSignal): Promise<readonly OcrWordPx[] | 'cancelled'>;
  terminate(): Promise<void>;
}

/** Imagen aceptada por tesseract.js (Blob, canvas, Buffer...). */
type WorkerImage = Parameters<Worker['recognize']>[0];

/** Confianza mínima (0-100) de una palabra para conservarla. */
const MIN_CONFIDENCE = 30;

/** Crea el motor con rutas locales: `${assetBaseUrl}ocr/`. */
export async function createOcrEngine(lang: OcrLanguage, assetBaseUrl: string): Promise<OcrEngine> {
  const base = `${assetBaseUrl}ocr/`;
  return createOcrEngineWithOptions(lang, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base,
    workerBlobURL: false,
    cacheMethod: 'none',
    gzip: true,
    logger: () => undefined,
  });
}

/**
 * Motor con las opciones de worker indicadas. Lo usan `createOcrEngine` (navegador y Tauri)
 * y el helper de tests en Node, que resuelve sus propias rutas. `toWorkerImage` adapta los `Blob` al formato
 * que acepta el worker (en Node, un Buffer).
 */
export async function createOcrEngineWithOptions(
  lang: OcrLanguage,
  options: Partial<WorkerOptions>,
  toWorkerImage: (image: Blob) => Promise<WorkerImage> | WorkerImage = (image) => image,
): Promise<OcrEngine> {
  const { createWorker, OEM } = await import('tesseract.js');
  const start = (): Promise<Worker> => createWorker(lang, OEM.LSTM_ONLY, options);

  let worker: Worker | null = await start();
  let closed = false;

  const run = async (image: Blob | ImageData, signal: AbortSignal): Promise<readonly OcrWordPx[]> => {
    const w = await current();
    const input = image instanceof Blob ? await toWorkerImage(image) : imageDataToCanvas(image);
    // Cancelado mientras se preparaba la imagen: no se usa un worker que puede estar ya terminado.
    if (signal.aborted) return [];
    const result = await w.recognize(input, {}, { blocks: true });
    return wordsOf(result.data);
  };

  const current = async (): Promise<Worker> => {
    if (closed) throw new Error('El motor OCR ya está terminado');
    worker ??= await start();
    return worker;
  };

  return {
    async recognize(image, signal) {
      if (signal.aborted) return 'cancelled';
      let onAbort: () => void = () => undefined;
      const cancelled = new Promise<'cancelled'>((resolve) => {
        onAbort = () => resolve('cancelled');
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const outcome = await Promise.race([run(image, signal), cancelled]);
        if (outcome !== 'cancelled') return outcome;
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      // tesseract.js no detiene un reconocimiento en curso: se termina el worker y se recrea en la siguiente llamada.
      const stale = worker;
      worker = null;
      await stale?.terminate();
      return 'cancelled';
    },
    async terminate() {
      closed = true;
      const w = worker;
      worker = null;
      if (w !== null) await w.terminate();
    },
  };
}

/** Aplana bloques → párrafos → líneas → palabras y descarta las vacías o poco fiables. */
function wordsOf(page: Page): OcrWordPx[] {
  const words: OcrWordPx[] = [];
  for (const block of page.blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const text = word.text.trim();
          if (text === '' || word.confidence < MIN_CONFIDENCE) continue;
          words.push({
            text,
            confidence: word.confidence,
            bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
          });
        }
      }
    }
  }
  return words;
}

function imageDataToCanvas(data: ImageData): OffscreenCanvas {
  const canvas = new OffscreenCanvas(data.width, data.height);
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('No se pudo crear el contexto 2D para el OCR');
  ctx.putImageData(data, 0, 0);
  return canvas;
}
