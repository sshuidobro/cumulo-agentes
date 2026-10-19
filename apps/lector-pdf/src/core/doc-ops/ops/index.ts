import { err, ok, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../../errors';
import { openForSave } from '../../pdf/incremental';
import { buildPdfFromImages, type ImageInput, type PageSizeMode } from '../../pdf/images-to-pdf';
import { readPageRotations, type PageRotation } from '../../pdf/page-tree';
import type { SaveSlot } from '../../organize/plan';
import { buildOrganizeUpdate } from '../../organize/save';
import type { DocOp, DocOpRegistry } from '../protocol';

interface PageRotationsArgs {
  readonly password: string | null;
}

/** Los argumentos los escribe el propio código de la app: si no encajan, es un bug, no un error del usuario. */
function parsePageRotationsArgs(args: unknown): PageRotationsArgs {
  if (typeof args !== 'object' || args === null || !('password' in args)) {
    throw new TypeError('page-rotations: argumentos no válidos.');
  }
  const password = args.password;
  if (password !== null && typeof password !== 'string') {
    throw new TypeError('page-rotations: la contraseña debe ser texto o null.');
  }
  return { password };
}

/** Giro efectivo de cada página del documento (fuente 0). */
const pageRotations: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password } = parsePageRotationsArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('page-rotations: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const rotations: Result<readonly PageRotation[]> = await readPageRotations(opened.value);
  return rotations;
};

interface OrganizeArgs {
  readonly password: string | null;
  readonly slots: readonly SaveSlot[];
  readonly now: string;
}

const SAVE_SLOT_KINDS: readonly string[] = ['original', 'blank', 'imported'];

function isSaveSlotLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    SAVE_SLOT_KINDS.includes(value.kind)
  );
}

/** Igual que `parsePageRotationsArgs`: un argumento mal formado es un bug de la app. La validación del plan es de `buildOrganizeUpdate`. */
function parseOrganizeArgs(args: unknown): OrganizeArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('slots' in args) || !('now' in args)) {
    throw new TypeError('organize: argumentos no válidos.');
  }
  const { password, slots, now } = args;
  if (password !== null && typeof password !== 'string') {
    throw new TypeError('organize: la contraseña debe ser texto o null.');
  }
  if (!Array.isArray(slots) || !slots.every(isSaveSlotLike)) throw new TypeError('organize: el plan no es una lista de huecos.');
  if (typeof now !== 'string') throw new TypeError('organize: la fecha debe ser texto.');
  return { password, slots: slots as readonly SaveSlot[], now };
}

/** Escribe el plan de páginas como un incremento sobre el documento (fuente 0, con los cambios sin guardar ya encadenados). */
const organize: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, slots, now } = parseOrganizeArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('organize: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const built = await buildOrganizeUpdate({
    source,
    reader: opened.value,
    slots,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!built.ok) return built;
  return ok({ delta: built.value.delta });
};

interface ImagesToPdfArgs {
  readonly images: readonly ImageInput[];
  readonly pageSize: PageSizeMode;
  readonly margin: number;
  readonly now: string;
}

/** Igual que `parseOrganizeArgs`: un argumento mal formado es un bug de la app. La validación de las imágenes es de `buildPdfFromImages`. */
function parseImagesToPdfArgs(args: unknown): ImagesToPdfArgs {
  if (typeof args !== 'object' || args === null || !('images' in args) || !('pageSize' in args) || !('margin' in args) || !('now' in args)) {
    throw new TypeError('images-to-pdf: argumentos no válidos.');
  }
  const { images, pageSize, margin, now } = args;
  if (!Array.isArray(images)) throw new TypeError('images-to-pdf: las imágenes deben ser una lista.');
  if (typeof pageSize !== 'string') throw new TypeError('images-to-pdf: el tamaño de página debe ser texto.');
  if (typeof margin !== 'number') throw new TypeError('images-to-pdf: el margen debe ser un número.');
  if (typeof now !== 'string') throw new TypeError('images-to-pdf: la fecha debe ser texto.');
  return { images: images as readonly ImageInput[], pageSize: pageSize as PageSizeMode, margin, now };
}

/** Crea un PDF con una página por imagen (PDF-056). Sin fuentes: las imágenes llegan en los argumentos. */
const imagesToPdf: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const parsed = parseImagesToPdfArgs(args);
  return buildPdfFromImages({
    ...parsed,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
};

/** Registro de operaciones del Worker. Cada ficha que añade una operación la registra aquí. */
export const DOC_OPS: DocOpRegistry = {
  'page-rotations': pageRotations,
  organize,
  'images-to-pdf': imagesToPdf,
};
