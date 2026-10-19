import { err, ok, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../../errors';
import { openForSave } from '../../pdf/incremental';
import { buildPdfFromImages, type ImageInput, type PageSizeMode } from '../../pdf/images-to-pdf';
import { readPageRotations, type PageRotation, type PageSlot } from '../../pdf/page-tree';
import type { SaveSlot } from '../../organize/plan';
import { buildOrganizeUpdate } from '../../organize/save';
import { buildZip, MAX_ZIP_BYTES } from '../../export/plan';
import { buildNewDocument } from '../../pdf/new-document';
import type { ObjectReader } from '../../pdf/object-reader';
import { readTopLevelOutline } from '../../pdf/outline-copy';
import {
  checkZipBudget,
  splitByBookmarks,
  splitByPageCount,
  splitBySize,
  splitPartNames,
  type SplitMode,
} from '../../organize/split';
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

interface ExtractArgs {
  readonly password: string | null;
  readonly pages: readonly number[];
  readonly now: string;
  readonly title: string;
}

function isPageIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/** Igual que `parsePageRotationsArgs`: un argumento mal formado es un bug de la app. */
function parseExtractArgs(args: unknown): ExtractArgs {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('password' in args) ||
    !('pages' in args) ||
    !('now' in args) ||
    !('title' in args)
  ) {
    throw new TypeError('extract: argumentos no válidos.');
  }
  const { password, pages, now, title } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('extract: la contraseña debe ser texto o null.');
  if (!Array.isArray(pages) || !pages.every(isPageIndex)) throw new TypeError('extract: las páginas deben ser índices enteros.');
  if (typeof now !== 'string') throw new TypeError('extract: la fecha debe ser texto.');
  if (typeof title !== 'string') throw new TypeError('extract: el título debe ser texto.');
  return { password, pages: pages as readonly number[], now, title };
}

/** Giro efectivo de cada página elegida: `undefined` si el índice no existe en el documento. */
function slotsFor(pages: readonly number[], rotations: readonly PageRotation[]): PageSlot[] | null {
  const slots: PageSlot[] = [];
  for (const source of pages) {
    const rotate = rotations[source];
    if (rotate === undefined) return null;
    slots.push({ source, rotate });
  }
  return slots;
}

/** Un PDF nuevo sin cifrar con las páginas elegidas, en ese orden (PDF-054). */
const extract: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, pages, now, title } = parseExtractArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('extract: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const rotations = await readPageRotations(opened.value);
  if (!rotations.ok) return rotations;
  const slots = slotsFor(pages, rotations.value);
  if (slots === null) return err(pdfError('organize-invalid'));
  const built = await buildNewDocument({
    parts: [{ reader: opened.value, pages: slots }],
    title,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!built.ok) return built;
  return ok({ bytes: built.value.bytes });
};

interface SplitArgs {
  readonly password: string | null;
  readonly mode: SplitMode;
  readonly baseName: string;
  readonly now: string;
}

const SPLIT_KINDS: readonly string[] = ['pages', 'bookmarks', 'size'];

function isSplitMode(value: unknown): value is SplitMode {
  if (typeof value !== 'object' || value === null || !('kind' in value) || typeof value.kind !== 'string') return false;
  if (!SPLIT_KINDS.includes(value.kind)) return false;
  if (value.kind === 'pages') return 'every' in value && typeof value.every === 'number';
  if (value.kind === 'size') return 'maxBytes' in value && typeof value.maxBytes === 'number';
  return true;
}

function parseSplitArgs(args: unknown): SplitArgs {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('password' in args) ||
    !('mode' in args) ||
    !('baseName' in args) ||
    !('now' in args)
  ) {
    throw new TypeError('split: argumentos no válidos.');
  }
  const { password, mode, baseName, now } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('split: la contraseña debe ser texto o null.');
  if (!isSplitMode(mode)) throw new TypeError('split: el modo de división no es válido.');
  if (typeof baseName !== 'string') throw new TypeError('split: el nombre base debe ser texto.');
  if (typeof now !== 'string') throw new TypeError('split: la fecha debe ser texto.');
  return { password, mode, baseName, now };
}

/** Grupos de páginas según el modo. Sin marcadores (ningún destino de página en el índice): error. */
async function planSplit(reader: ObjectReader, mode: SplitMode, signal: AbortSignal): Promise<Result<readonly (readonly number[])[], AppError>> {
  if (mode.kind === 'pages') return ok(splitByPageCount(await reader.pageCount(), mode.every));
  if (mode.kind === 'bookmarks') {
    const top = await readTopLevelOutline(reader);
    if (!top.some((entry) => entry.pageIndex !== null)) return err(pdfError('split-no-bookmarks'));
    return ok(splitByBookmarks(top, await reader.pageCount()));
  }
  return ok((await splitBySize(reader, mode.maxBytes, signal)).groups);
}

/** Un elemento de `items` que existe: lanza si el índice está fuera de rango (bug de quien llama). */
function itemAt<T>(items: readonly T[], index: number): T {
  const item = items[index];
  if (item === undefined) throw new RangeError(`índice ${index} fuera de rango`);
  return item;
}

interface BuiltPart {
  readonly pages: readonly number[];
  readonly bytes: Uint8Array;
}

/**
 * Divide el PDF en partes (PDF-054): un PDF por grupo dentro de un ZIP con nombres «<base>-parte-NN.pdf».
 * En modo `size` hay red de seguridad: si una parte escrita supera `maxBytes` y tiene más de una página, se parte
 * en dos mitades y se reconstruye cada una (recursivo). `oversized` cuenta las partes de una página que superan el máximo.
 */
const split: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, mode, baseName, now } = parseSplitArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('split: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const reader = opened.value;
  const planned = await planSplit(reader, mode, ctx.signal);
  if (!planned.ok) return planned;
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const rotations = await readPageRotations(reader);
  if (!rotations.ok) return rotations;
  const groups = planned.value;
  const maxBytes = mode.kind === 'size' ? mode.maxBytes : null;

  const total = groups.reduce((sum, group) => sum + group.length, 0);
  let done = 0;
  const sizes: number[] = [];

  /** Construye un grupo; si en modo `size` la parte escrita se pasa del máximo, lo parte en mitades. */
  const buildGroup = async (group: readonly number[]): Promise<Result<readonly BuiltPart[], AppError>> => {
    const slots = slotsFor(group, rotations.value);
    if (slots === null) return err(pdfError('organize-invalid'));
    const base = done;
    const built = await buildNewDocument({
      parts: [{ reader, pages: slots }],
      now,
      signal: ctx.signal,
      onProgress: (count) => {
        ctx.progress(Math.min(base + count, total), total);
      },
    });
    if (!built.ok) return built;
    done = base + group.length;
    const bytes = built.value.bytes;
    if (maxBytes === null || bytes.length <= maxBytes || group.length === 1) return ok([{ pages: group, bytes }]);
    const cut = Math.ceil(group.length / 2);
    const first = await buildGroup(group.slice(0, cut));
    if (!first.ok) return first;
    const second = await buildGroup(group.slice(cut));
    if (!second.ok) return second;
    return ok([...first.value, ...second.value]);
  };

  const parts: BuiltPart[] = [];
  for (const group of groups) {
    const built = await buildGroup(group);
    if (!built.ok) return built;
    for (const part of built.value) {
      sizes.push(part.bytes.length);
      if (!checkZipBudget(sizes, MAX_ZIP_BYTES)) return err(pdfError('split-too-big'));
      parts.push(part);
    }
  }

  const names = splitPartNames(baseName, parts.length);
  const entries = parts.map((part, index) => ({ name: itemAt(names, index), bytes: part.bytes }));
  const oversized = maxBytes === null ? 0 : parts.filter((part) => part.pages.length === 1 && part.bytes.length > maxBytes).length;
  return ok({ zip: buildZip(entries), parts: parts.length, oversized });
};

/** Registro de operaciones del Worker. Cada ficha que añade una operación la registra aquí. */
export const DOC_OPS: DocOpRegistry = {
  'page-rotations': pageRotations,
  organize,
  'images-to-pdf': imagesToPdf,
  extract,
  split,
};
