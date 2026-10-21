import type { FileFilter } from '@suite/platform';
import type { ImageInput, PageSizeMode } from '../core/pdf/images-to-pdf';
import { imagesMsg } from '../ui/messages-images';
import { nowIso } from './annotation-actions';
import { runDocOp } from './doc-ops';
import { openRequested, PDF_FILTERS } from './document-actions';
import { beginJob, endJob, jobOptions, useDocOpJob } from './extract-actions';
import { showNotice } from './notice';
import { services } from './services';
import { useImagesDialog, type ImageItem, type MarginChoice } from './images-dialog-store';

export { useImagesDialog, type ImageItem, type MarginChoice } from './images-dialog-store';

/** Formatos que el diálogo acepta al elegir ficheros. */
export const IMAGE_FILTERS: readonly FileFilter[] = [
  { name: 'Imágenes', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] },
];
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGES = 500;
/** Píxeles por imagen (ancho × alto). Más grande → no se puede leer. */
export const MAX_IMAGE_PIXELS = 50_000_000;

const PAGE_SIZES: readonly PageSizeMode[] = ['fit', 'a4', 'letter'];
const DEFAULT_PAGE_SIZE: PageSizeMode = 'a4';
const DEFAULT_MARGIN: MarginChoice = 18;
const OPTIONS_PREF = 'images-pdf-options';

/** Resultado de crear el PDF. `failed` si no se pudo (ya avisado). */
export type CreateImagesOutcome = 'saved' | 'downloaded' | 'cancelled' | 'failed';

interface SavedOptions {
  readonly pageSize: PageSizeMode;
  readonly margin: MarginChoice;
}

function isPageSize(value: unknown): value is PageSizeMode {
  return typeof value === 'string' && (PAGE_SIZES as readonly string[]).includes(value);
}

function isMargin(value: unknown): value is MarginChoice {
  return value === 0 || value === 18 || value === 36;
}

function isSavedOptions(value: unknown): value is SavedOptions {
  if (typeof value !== 'object' || value === null || !('pageSize' in value) || !('margin' in value)) return false;
  return isPageSize(value.pageSize) && isMargin(value.margin);
}

function persistOptions(): void {
  const { pageSize, margin } = useImagesDialog.getState();
  services().platform.prefs.set(OPTIONS_PREF, { pageSize, margin });
}

/** Elige el tamaño de página y lo recuerda. */
export function setImagesPageSize(pageSize: PageSizeMode): void {
  useImagesDialog.setState({ pageSize });
  persistOptions();
}

/** Elige el margen y lo recuerda. */
export function setImagesMargin(margin: MarginChoice): void {
  useImagesDialog.setState({ margin });
  persistOptions();
}

/** Blob con los bytes de un fichero. Los bytes vienen de la plataforma, que siempre los entrega sobre un ArrayBuffer. */
function blobOf(bytes: Uint8Array): Blob {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]);
}

function revokeAll(items: readonly ImageItem[]): void {
  for (const item of items) URL.revokeObjectURL(item.previewUrl);
}

/** Abre el diálogo con las preferencias guardadas y lanza el selector de imágenes. */
export function openImagesDialog(): Promise<void> {
  revokeAll(useImagesDialog.getState().items);
  const saved = services().platform.prefs.get(OPTIONS_PREF, isSavedOptions);
  useImagesDialog.setState({
    open: true,
    items: [],
    pageSize: saved?.pageSize ?? DEFAULT_PAGE_SIZE,
    margin: saved?.margin ?? DEFAULT_MARGIN,
  });
  return addImages();
}

/** Cierra el diálogo y libera las miniaturas. */
export function closeImagesDialog(): void {
  const { items } = useImagesDialog.getState();
  useImagesDialog.setState({ open: false, items: [] });
  revokeAll(items);
}

let itemCounter = 0;

/**
 * Elige varias imágenes y las añade al final de la lista. Si con ellas se pasa de `MAX_IMAGES` o alguna pasa de
 * `MAX_IMAGE_BYTES`, avisa y no añade nada.
 */
export async function addImages(): Promise<void> {
  // El límite de número se comprueba aquí y no en la plataforma: así «más de 500» y «más de 50 MB» tienen aviso propio.
  const picked = await services().platform.importFiles(IMAGE_FILTERS, MAX_IMAGE_BYTES, Number.MAX_SAFE_INTEGER);
  if (!picked.ok) {
    showNotice(picked.error.code === 'out-of-range' ? imagesMsg.tooBig : picked.error.message);
    return;
  }
  const files = picked.value;
  if (files === null) return;
  if (files.some((file) => file.bytes.length > MAX_IMAGE_BYTES)) {
    showNotice(imagesMsg.tooBig);
    return;
  }
  if (useImagesDialog.getState().items.length + files.length > MAX_IMAGES) {
    showNotice(imagesMsg.tooMany);
    return;
  }
  // Si el diálogo se cerró mientras se elegían los ficheros, no se añade nada.
  if (files.length === 0 || !useImagesDialog.getState().open) return;
  const added: ImageItem[] = files.map((file) => {
    itemCounter += 1;
    return {
      id: `image-${String(itemCounter)}`,
      name: file.name,
      bytes: file.bytes,
      previewUrl: URL.createObjectURL(blobOf(file.bytes)),
    };
  });
  useImagesDialog.setState((state) => ({ items: [...state.items, ...added] }));
}

/** Sube (-1) o baja (+1) una imagen. En los extremos no hace nada. */
export function moveImage(id: string, delta: -1 | 1): void {
  useImagesDialog.setState((state) => {
    const items = [...state.items];
    const from = items.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= items.length) return state;
    const [moved] = items.splice(from, 1);
    if (moved === undefined) return state;
    items.splice(to, 0, moved);
    return { items };
  });
}

/** Quita una imagen de la lista y revoca su miniatura. */
export function removeImage(id: string): void {
  const item = useImagesDialog.getState().items.find((candidate) => candidate.id === id);
  if (item === undefined) return;
  URL.revokeObjectURL(item.previewUrl);
  useImagesDialog.setState((state) => ({ items: state.items.filter((candidate) => candidate.id !== id) }));
}

type Context2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

function context2d(width: number, height: number): Context2D | null {
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height).getContext('2d');
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas.getContext('2d');
}

/** Cede el hilo principal para que la interfaz siga respondiendo entre imágenes. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/**
 * Prepara una imagen para el PDF: un JPEG legible se usa con sus bytes; el resto se decodifica a RGBA.
 * `null` si no se puede leer o supera `MAX_IMAGE_PIXELS`.
 */
async function prepareImage(item: ImageItem): Promise<ImageInput | null> {
  // Los módulos del núcleo que usa esta ruta se cargan al crear el PDF y no en el arranque (presupuesto de bundle).
  const { isJpegBytes } = await import('../core/signature/image-art');
  if (isJpegBytes(item.bytes)) {
    const { readJpegInfo } = await import('../core/pdf/image');
    const info = readJpegInfo(item.bytes);
    if (info !== null) {
      return info.width * info.height <= MAX_IMAGE_PIXELS ? { kind: 'jpeg', name: item.name, bytes: item.bytes } : null;
    }
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blobOf(item.bytes));
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    if (width * height > MAX_IMAGE_PIXELS) return null;
    const ctx = context2d(width, height);
    if (ctx === null) return null;
    ctx.drawImage(bitmap, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height);
    return { kind: 'rgba', name: item.name, image: { width, height, rgba: new Uint8Array(pixels.data.buffer) } };
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}

/**
 * Crea un PDF con una página por imagen, en el orden de la lista, y lo guarda con el diálogo del sistema. Si alguna
 * imagen no se puede leer, avisa y no crea nada. Cancelar no guarda nada. Nunca lanza.
 */
export async function createPdfFromImages(): Promise<CreateImagesOutcome> {
  const { items, pageSize, margin } = useImagesDialog.getState();
  const first = items[0];
  if (first === undefined) return 'failed';
  const controller = beginJob(imagesMsg.title, imagesMsg.progress);
  if (controller === null) return 'failed';
  try {
    const images: ImageInput[] = [];
    for (const [index, item] of items.entries()) {
      if (controller.signal.aborted) return 'cancelled';
      useDocOpJob.setState({ done: index, total: items.length });
      const prepared = await prepareImage(item);
      await yieldToUi();
      if (controller.signal.aborted) return 'cancelled';
      if (prepared === null) {
        showNotice(imagesMsg.cannotRead(item.name));
        return 'failed';
      }
      images.push(prepared);
    }
    const result = await runDocOp<{ readonly bytes: Uint8Array }>(
      'images-to-pdf',
      { images, pageSize, margin, now: nowIso() },
      [],
      jobOptions(controller),
    );
    if (controller.signal.aborted) return 'cancelled';
    endJob(controller);
    if (!result.ok) {
      showNotice(result.error.message);
      return 'failed';
    }
    const { exportBaseName } = await import('../core/export/plan');
    const outcome = await services().platform.saveAs(`${exportBaseName(first.name)}.pdf`, PDF_FILTERS, {
      kind: 'bytes',
      bytes: result.value.bytes,
    });
    if (!outcome.ok) {
      showNotice(outcome.error.message);
      return 'failed';
    }
    switch (outcome.value.kind) {
      case 'cancelled':
        return 'cancelled';
      case 'saved':
        closeImagesDialog();
        await openRequested(outcome.value.file);
        return 'saved';
      case 'downloaded':
        closeImagesDialog();
        showNotice(imagesMsg.created(outcome.value.name));
        return 'downloaded';
    }
  } finally {
    endJob(controller);
  }
}
