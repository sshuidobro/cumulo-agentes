import { err, ok, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../../errors';
import { openForSave } from '../../pdf/incremental';
import { buildPdfFromImages, type ImageInput, type PageSizeMode } from '../../pdf/images-to-pdf';
import { readPageRotations, type PageRotation, type PageSlot } from '../../pdf/page-tree';
import type { SaveSlot } from '../../organize/plan';
import { buildOrganizeUpdate } from '../../organize/save';
import { buildOcrUpdate, type OcrPage } from '../../ocr/text-layer';
import { buildZip, MAX_ZIP_BYTES } from '../../export/plan';
import { buildNewDocument, type NewDocumentPart } from '../../pdf/new-document';
import type { ObjectReader } from '../../pdf/object-reader';
import type { NewSecurityInput, PermissionChoice } from '../../pdf/crypto';
import { PERMISSION_FLAG } from '../../permissions';
import { rewriteDocument } from '../../pdf/rewrite';
import { concatSource } from '../../pdf/concat-source';
import { buildRedactionUpdate, planRedaction, type RedactArea } from '../../redact/apply';
import { readTopLevelOutline } from '../../pdf/outline-copy';
import {
  checkZipBudget,
  splitByBookmarks,
  splitByPageCount,
  splitBySize,
  splitPartNames,
  type SplitMode,
} from '../../organize/split';
import { p12Info, signPdf, verifySignaturesOp } from './signature';
import type { DocOp, DocOpRegistry, OpContext } from '../protocol';

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
  /** Contraseña de cada PDF importado (fuentes 1..k), en orden; `null` si no tiene. */
  readonly importedPasswords: readonly (string | null)[];
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
  // Sin `importedPasswords` no hay PDF importados (la vista Organizar de PDF-053 no los envía).
  const importedPasswords = 'importedPasswords' in args ? args.importedPasswords : [];
  if (!Array.isArray(importedPasswords) || !importedPasswords.every((p) => p === null || typeof p === 'string')) {
    throw new TypeError('organize: las contraseñas importadas deben ser texto o null.');
  }
  return { password, slots: slots as readonly SaveSlot[], now, importedPasswords: importedPasswords as readonly (string | null)[] };
}

/** Escribe el plan de páginas como un incremento sobre el documento (fuente 0, con los cambios sin guardar ya encadenados). */
const organize: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, slots, now, importedPasswords } = parseOrganizeArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('organize: falta el documento (fuente 0).');
  if (ctx.sources.length - 1 !== importedPasswords.length) throw new RangeError('organize: una contraseña por PDF importado (bug).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const imported: ObjectReader[] = [];
  for (const [index, importedSource] of ctx.sources.slice(1).entries()) {
    const reader = await openForSave(importedSource, importedPasswords[index] ?? undefined);
    if (!reader.ok) return reader;
    imported.push(reader.value);
  }
  const built = await buildOrganizeUpdate({
    source,
    reader: opened.value,
    slots,
    imported,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!built.ok) return built;
  return ok({ delta: built.value.delta });
};

interface CombineArgs {
  readonly parts: readonly { readonly password: string | null; readonly title: string }[];
  readonly now: string;
}

/** Igual que `parseOrganizeArgs`: un argumento mal formado es un bug de la app. */
function parseCombineArgs(args: unknown): CombineArgs {
  if (typeof args !== 'object' || args === null || !('parts' in args) || !('now' in args)) {
    throw new TypeError('combine: argumentos no válidos.');
  }
  const { parts, now } = args;
  if (!Array.isArray(parts)) throw new TypeError('combine: las partes deben ser una lista.');
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || !('password' in part) || !('title' in part)) {
      throw new TypeError('combine: cada parte necesita contraseña y título.');
    }
    if (part.password !== null && typeof part.password !== 'string') throw new TypeError('combine: la contraseña debe ser texto o null.');
    if (typeof part.title !== 'string') throw new TypeError('combine: el título debe ser texto.');
  }
  if (typeof now !== 'string') throw new TypeError('combine: la fecha debe ser texto.');
  return { parts: parts as CombineArgs['parts'], now };
}

/**
 * Un PDF nuevo con todas las páginas de cada fuente (una parte por fuente, en orden), con una rama del índice por
 * parte (PDF-055). Las páginas van con su giro efectivo.
 */
const combine: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { parts, now } = parseCombineArgs(args);
  if (ctx.sources.length !== parts.length) throw new RangeError('combine: una fuente por parte (bug).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const newParts: NewDocumentPart[] = [];
  for (const [index, part] of parts.entries()) {
    const source = ctx.sources[index];
    if (source === undefined) throw new RangeError('combine: falta una fuente (bug).');
    const opened = await openForSave(source, part.password ?? undefined);
    if (!opened.ok) return opened;
    const rotations = await readPageRotations(opened.value);
    if (!rotations.ok) return rotations;
    const pages: PageSlot[] = rotations.value.map((rotate, page) => ({ source: page, rotate }));
    newParts.push({ reader: opened.value, pages, title: part.title });
  }
  const built = await buildNewDocument({
    parts: newParts,
    outline: 'branches',
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!built.ok) return built;
  return ok({ bytes: built.value.bytes, pageCount: built.value.pageCount });
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

interface PasswordNowArgs {
  readonly password: string | null;
  readonly now: string;
}

/** Igual que `parsePageRotationsArgs`: un argumento mal formado es un bug de la app. */
function parsePasswordNowArgs(op: string, args: unknown): PasswordNowArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('now' in args)) {
    throw new TypeError(`${op}: argumentos no válidos.`);
  }
  const { password, now } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError(`${op}: la contraseña debe ser texto o null.`);
  if (typeof now !== 'string') throw new TypeError(`${op}: la fecha debe ser texto.`);
  return { password, now };
}

interface ProtectArgs extends PasswordNowArgs {
  readonly userPassword: string;
  readonly ownerPassword: string;
  readonly permissions: PermissionChoice;
}

function isPermissionChoice(value: unknown): value is PermissionChoice {
  if (typeof value !== 'object' || value === null) return false;
  return (
    'print' in value &&
    (value.print === 'none' || value.print === 'low' || value.print === 'high') &&
    'modify' in value &&
    typeof value.modify === 'boolean' &&
    'copy' in value &&
    typeof value.copy === 'boolean' &&
    'annotate' in value &&
    typeof value.annotate === 'boolean' &&
    'fillForms' in value &&
    typeof value.fillForms === 'boolean' &&
    'assemble' in value &&
    typeof value.assemble === 'boolean'
  );
}

function parseProtectArgs(args: unknown): ProtectArgs {
  if (
    typeof args !== 'object' ||
    args === null ||
    !('userPassword' in args) ||
    !('ownerPassword' in args) ||
    !('permissions' in args)
  ) {
    throw new TypeError('protect: argumentos no válidos.');
  }
  const base = parsePasswordNowArgs('protect', args);
  const { userPassword, ownerPassword, permissions } = args;
  if (typeof userPassword !== 'string' || typeof ownerPassword !== 'string') {
    throw new TypeError('protect: las contraseñas deben ser texto.');
  }
  if (!isPermissionChoice(permissions)) throw new TypeError('protect: los permisos no son válidos.');
  return { ...base, userPassword, ownerPassword, permissions };
}

/** Banderas de `/P` que hacen falta para que el documento no tenga restricciones. */
const ALL_PERMISSION_FLAGS: readonly number[] = [
  PERMISSION_FLAG.PRINT,
  PERMISSION_FLAG.PRINT_HIGH_QUALITY,
  PERMISSION_FLAG.MODIFY_CONTENTS,
  PERMISSION_FLAG.COPY,
  PERMISSION_FLAG.MODIFY_ANNOTATIONS,
  PERMISSION_FLAG.FILL_INTERACTIVE_FORMS,
  PERMISSION_FLAG.ASSEMBLE,
];

/** `true` si el valor `/P` no restringe ninguna acción. */
function permitsEverything(p: number): boolean {
  return ALL_PERMISSION_FLAGS.every((flag) => (p & flag) !== 0);
}

/** Abre la fuente 0 con la contraseña dada (`null` = vacía). */
async function openSource(ctx: OpContext, password: string | null): Promise<Result<ObjectReader, AppError>> {
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('protección: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  return openForSave(source, password ?? undefined);
}

/** Protege el PDF con AES-256 y permisos elegidos (PDF-131): reescritura completa con cifrado nuevo. */
const protect: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const parsed = parseProtectArgs(args);
  const opened = await openSource(ctx, parsed.password);
  if (!opened.ok) return opened;
  const encryption: NewSecurityInput = {
    userPassword: parsed.userPassword,
    ownerPassword: parsed.ownerPassword,
    permissions: parsed.permissions,
    random: opened.value.random,
  };
  const written = await rewriteDocument({
    reader: opened.value,
    encryption,
    now: parsed.now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!written.ok) return written;
  return ok({ bytes: written.value.bytes });
};

/**
 * Quita la protección (PDF-131). Sin cifrado → `not-protected`. Con la contraseña de usuario y permisos restringidos
 * → `owner-password-required` (hace falta la de propietario para quitar lo que la de usuario no permite).
 */
const unprotect: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, now } = parsePasswordNowArgs('unprotect', args);
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  const reader = opened.value;
  const security = reader.security;
  if (security === null) return err(pdfError('not-protected'));
  if (security.authenticatedAs === 'user' && !permitsEverything(security.permissions)) {
    return err(pdfError('owner-password-required'));
  }
  const written = await rewriteDocument({
    reader,
    encryption: null,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!written.ok) return written;
  return ok({ bytes: written.value.bytes });
};

/** Reescribe el PDF completo conservando su cifrado si lo tiene (PDF-131): lo usa la redacción (PDF-135). */
const rewrite: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, now } = parsePasswordNowArgs('rewrite', args);
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  const written = await rewriteDocument({
    reader: opened.value,
    encryption: null,
    keepEncryption: true,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!written.ok) return written;
  return ok({ bytes: written.value.bytes });
};

interface OcrLayerArgs {
  readonly password: string | null;
  readonly pages: readonly OcrPage[];
  readonly now: string;
}

const PAGE_ROTATIONS: readonly unknown[] = [0, 90, 180, 270];

/** Igual que `parseOrganizeArgs`: un argumento mal formado es un bug de la app. La validación de las páginas es de `buildOcrUpdate`. */
function parseOcrLayerArgs(args: unknown): OcrLayerArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('pages' in args) || !('now' in args)) {
    throw new TypeError('ocr-layer: argumentos no válidos.');
  }
  const { password, pages, now } = args;
  if (password !== null && typeof password !== 'string') {
    throw new TypeError('ocr-layer: la contraseña debe ser texto o null.');
  }
  if (!Array.isArray(pages) || !pages.every(isOcrPageLike)) throw new TypeError('ocr-layer: las páginas no son una lista de páginas OCR.');
  if (typeof now !== 'string') throw new TypeError('ocr-layer: la fecha debe ser texto.');
  return { password, pages: pages as readonly OcrPage[], now };
}

function isOcrPageLike(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'pageIndex' in value &&
    typeof value.pageIndex === 'number' &&
    'rotate' in value &&
    PAGE_ROTATIONS.includes(value.rotate) &&
    'words' in value &&
    Array.isArray(value.words)
  );
}

/** Escribe la capa de texto OCR de las páginas indicadas como un incremento (fuente 0). */
const ocrLayer: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, pages, now } = parseOcrLayerArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('ocr-layer: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const built = await buildOcrUpdate({
    source,
    reader: opened.value,
    pages,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!built.ok) return built;
  return ok({ delta: built.value.delta });
};

interface RedactArgs {
  readonly password: string | null;
  readonly areas: readonly RedactArea[];
  readonly rasterPages: ReadonlyMap<number, Uint8Array>;
  readonly imageReplacements: ReadonlyMap<string, Uint8Array>;
  readonly now: string;
}

/** Igual que `parseOcrLayerArgs`: un argumento mal formado es un bug de la app. La validación de las zonas es de `planRedaction`. */
function parseRedactArgs(op: string, args: unknown, full: boolean): RedactArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('areas' in args)) {
    throw new TypeError(`${op}: argumentos no válidos.`);
  }
  const { password, areas } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError(`${op}: la contraseña debe ser texto o null.`);
  if (!Array.isArray(areas)) throw new TypeError(`${op}: las zonas deben ser una lista.`);
  const parsedAreas = areas.map((item: unknown): RedactArea => parseRedactArea(op, item));
  if (!full) return { password, areas: parsedAreas, rasterPages: new Map(), imageReplacements: new Map(), now: '' };
  if (!('rasterPages' in args) || !('now' in args) || typeof args.now !== 'string' || !Array.isArray(args.rasterPages)) {
    throw new TypeError(`${op}: faltan las páginas en imagen o la fecha.`);
  }
  if (!('imageReplacements' in args) || !Array.isArray(args.imageReplacements)) {
    throw new TypeError(`${op}: faltan las imágenes sustituidas.`);
  }
  const imageReplacements = new Map<string, Uint8Array>();
  for (const entry of args.imageReplacements) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError(`${op}: imagen sustituida no válida.`);
    const [key, bytes] = entry;
    if (typeof key !== 'string' || !(bytes instanceof Uint8Array)) throw new TypeError(`${op}: imagen sustituida no válida.`);
    imageReplacements.set(key, bytes);
  }
  const rasterPages = new Map<number, Uint8Array>();
  for (const entry of args.rasterPages) {
    if (!Array.isArray(entry) || entry.length !== 2) throw new TypeError(`${op}: página en imagen no válida.`);
    const [pageIndex, bytes] = entry;
    if (typeof pageIndex !== 'number' || !(bytes instanceof Uint8Array)) throw new TypeError(`${op}: página en imagen no válida.`);
    rasterPages.set(pageIndex, bytes);
  }
  return { password, areas: parsedAreas, rasterPages, imageReplacements, now: args.now };
}

function parseRedactArea(op: string, value: unknown): RedactArea {
  if (typeof value !== 'object' || value === null || !('pageIndex' in value) || !('rect' in value)) {
    throw new TypeError(`${op}: zona no válida.`);
  }
  const { pageIndex, rect } = value;
  if (typeof pageIndex !== 'number' || !Array.isArray(rect) || rect.length !== 4 || !rect.every((v) => typeof v === 'number')) {
    throw new TypeError(`${op}: zona no válida.`);
  }
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = rect as readonly number[];
  return { pageIndex, rect: [x0, y0, x1, y1] };
}

/** Zonas por página: plan de redacción (PDF-135). Sin escribir nada. */
const redactPlan: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, areas } = parseRedactArgs('redact-plan', args, false);
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  return planRedaction(opened.value, areas);
};

/** Redacta las zonas y reescribe el fichero completo conservando su cifrado (PDF-135). */
const redact: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, areas, rasterPages, imageReplacements, now } = parseRedactArgs('redact', args, true);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('redact: falta el documento (fuente 0).');
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  const built = await buildRedactionUpdate({ source, reader: opened.value, areas, rasterPages, imageReplacements, now, signal: ctx.signal });
  if (!built.ok) return built;
  const reopened = await openForSave(concatSource(source, built.value.delta), password ?? undefined);
  if (!reopened.ok) return reopened;
  const written = await rewriteDocument({
    reader: reopened.value,
    encryption: null,
    keepEncryption: true,
    now,
    signal: ctx.signal,
    onProgress: (done, total) => {
      ctx.progress(done, total);
    },
  });
  if (!written.ok) return written;
  return ok({ bytes: written.value.bytes });
};

/** Registro de operaciones del Worker. Cada ficha que añade una operación la registra aquí. */
export const DOC_OPS: DocOpRegistry = {
  'page-rotations': pageRotations,
  organize,
  combine,
  'images-to-pdf': imagesToPdf,
  extract,
  split,
  protect,
  unprotect,
  rewrite,
  'ocr-layer': ocrLayer,
  'redact-plan': redactPlan,
  redact,
  'p12-info': p12Info,
  sign: signPdf,
  'verify-signatures': verifySignaturesOp,
};
