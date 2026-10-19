import { err, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../../errors';
import { openForSave } from '../../pdf/incremental';
import { readPageRotations, type PageRotation } from '../../pdf/page-tree';
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

/** Registro de operaciones del Worker. Cada ficha que añade una operación la registra aquí. */
export const DOC_OPS: DocOpRegistry = {
  'page-rotations': pageRotations,
};
