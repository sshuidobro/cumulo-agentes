/**
 * Operaciones del Worker de la edición de texto (PDF-145, ADR-0042): consultar si una línea es editable y reescribir
 * el fichero con las líneas editadas. Los argumentos los escribe el propio código de la app: si no encajan, es un bug.
 */
import { err, ok, type AppError, type Result } from '@suite/shared';
import { findEditableLine, type EditableLine, type LineIssue } from '../../edit-text';
import { buildTextEditUpdate, type LineEdit } from '../../edit-text/apply';
import type { RectPt } from '../../annotations/model';
import { pdfError } from '../../errors';
import { concatSource } from '../../pdf/concat-source';
import { openForSave } from '../../pdf/incremental';
import type { ObjectReader } from '../../pdf/object-reader';
import { rewriteDocument } from '../../pdf/rewrite';
import type { DocOp, OpContext } from '../protocol';

/** Resultado de `edit-text-probe`: la línea localizada o el motivo por el que no es editable. */
export type EditTextProbe = { readonly line: EditableLine } | { readonly issue: LineIssue };

interface ProbeArgs {
  readonly password: string | null;
  readonly pageIndex: number;
  readonly hint: RectPt;
}

interface EditArgs {
  readonly password: string | null;
  readonly edits: readonly LineEdit[];
  readonly now: string;
}

function parseRect(op: string, value: unknown): RectPt {
  if (!Array.isArray(value) || value.length !== 4 || !value.every((v) => typeof v === 'number')) {
    throw new TypeError(`${op}: caja no válida.`);
  }
  const [x0 = 0, y0 = 0, x1 = 0, y1 = 0] = value as readonly number[];
  return [x0, y0, x1, y1];
}

function parseProbeArgs(args: unknown): ProbeArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('pageIndex' in args) || !('hint' in args)) {
    throw new TypeError('edit-text-probe: argumentos no válidos.');
  }
  const { password, pageIndex } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('edit-text-probe: la contraseña debe ser texto o null.');
  if (typeof pageIndex !== 'number') throw new TypeError('edit-text-probe: la página debe ser un número.');
  return { password, pageIndex, hint: parseRect('edit-text-probe', args.hint) };
}

function parseEditArgs(args: unknown): EditArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('edits' in args) || !('now' in args)) {
    throw new TypeError('edit-text: argumentos no válidos.');
  }
  const { password, edits, now } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('edit-text: la contraseña debe ser texto o null.');
  if (typeof now !== 'string') throw new TypeError('edit-text: falta la fecha.');
  if (!Array.isArray(edits)) throw new TypeError('edit-text: las ediciones deben ser una lista.');
  return { password, edits: edits.map(parseEdit), now };
}

function parseEdit(value: unknown): LineEdit {
  if (typeof value !== 'object' || value === null || !('pageIndex' in value) || !('hint' in value) || !('text' in value)) {
    throw new TypeError('edit-text: edición no válida.');
  }
  const { pageIndex, text } = value;
  if (typeof pageIndex !== 'number' || typeof text !== 'string') throw new TypeError('edit-text: edición no válida.');
  return { pageIndex, hint: parseRect('edit-text', value.hint), text };
}

async function openSource(ctx: OpContext, password: string | null): Promise<Result<ObjectReader, AppError>> {
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('edit-text: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  return openForSave(source, password ?? undefined);
}

/** Línea editable en la caja dada (PDF-145). Sin escribir nada. */
const editTextProbe: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, pageIndex, hint } = parseProbeArgs(args);
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  const located = await findEditableLine(opened.value, pageIndex, hint);
  const probe: EditTextProbe = located.ok ? { line: located.value } : { issue: located.error };
  return ok(probe);
};

/** Aplica las líneas editadas y reescribe el fichero completo conservando su cifrado (PDF-145). */
const editText: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password, edits, now } = parseEditArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('edit-text: falta el documento (fuente 0).');
  const opened = await openSource(ctx, password);
  if (!opened.ok) return opened;
  const built = await buildTextEditUpdate({ source, reader: opened.value, edits, now, signal: ctx.signal });
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

export const EDIT_TEXT_OPS = {
  'edit-text-probe': editTextProbe,
  'edit-text': editText,
} as const;
