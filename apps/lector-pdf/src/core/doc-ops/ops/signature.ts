/**
 * Operaciones del Worker de la firma digital (PDF-066, ADR-0040): leer los datos de un certificado .p12/.pfx y
 * firmar un PDF con PAdES B-B. El módulo de firma (node-forge) se carga bajo demanda.
 */
import { err, ok, type AppError, type Result } from '@suite/shared';
import { pdfError } from '../../errors';
import { openForSave } from '../../pdf/incremental';
import type { RectPt } from '../../annotations/model';
import type { DocOp } from '../protocol';

interface P12InfoArgs {
  readonly p12: Uint8Array;
  readonly password: string;
}

interface SignArgs {
  readonly password: string | null;
  readonly p12: Uint8Array;
  readonly p12Password: string;
  readonly pageIndex: number;
  readonly rect: RectPt | null;
  readonly reason: string;
  readonly location: string;
  readonly now: string;
}

/** Los argumentos los escribe el propio código de la app: si no encajan, es un bug, no un error del usuario. */
function parseP12InfoArgs(args: unknown): P12InfoArgs {
  if (typeof args !== 'object' || args === null || !('p12' in args) || !('password' in args)) {
    throw new TypeError('p12-info: argumentos no válidos.');
  }
  const { p12, password } = args;
  if (!(p12 instanceof Uint8Array)) throw new TypeError('p12-info: el certificado debe ser un Uint8Array.');
  if (typeof password !== 'string') throw new TypeError('p12-info: la contraseña debe ser texto.');
  return { p12, password };
}

function isRect(value: unknown): value is RectPt {
  return Array.isArray(value) && value.length === 4 && value.every((n) => typeof n === 'number' && Number.isFinite(n));
}

function parseSignArgs(args: unknown): SignArgs {
  if (typeof args !== 'object' || args === null || !('password' in args) || !('p12' in args) || !('p12Password' in args)
    || !('pageIndex' in args) || !('rect' in args) || !('reason' in args) || !('location' in args) || !('now' in args)) {
    throw new TypeError('sign: argumentos no válidos.');
  }
  const { password, p12, p12Password, pageIndex, rect, reason, location, now } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('sign: la contraseña debe ser texto o null.');
  if (!(p12 instanceof Uint8Array)) throw new TypeError('sign: el certificado debe ser un Uint8Array.');
  if (typeof p12Password !== 'string') throw new TypeError('sign: la contraseña del certificado debe ser texto.');
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0) throw new TypeError('sign: página no válida.');
  if (rect !== null && !isRect(rect)) throw new TypeError('sign: el rectángulo no es válido.');
  if (typeof reason !== 'string' || typeof location !== 'string') throw new TypeError('sign: motivo y lugar deben ser texto.');
  if (typeof now !== 'string') throw new TypeError('sign: la fecha debe ser texto.');
  return { password, p12, p12Password, pageIndex, rect, reason, location, now };
}

/** Datos del certificado (CN, emisor, validez): para mostrarlos antes de firmar. Nunca devuelve la clave. */
const p12Info: DocOp = async (args): Promise<Result<unknown, AppError>> => {
  const { p12, password } = parseP12InfoArgs(args);
  const { openP12 } = await import('../../signature/digital');
  const opened = openP12(p12, password);
  if (!opened.ok) return opened;
  return ok(opened.value.info);
};

/** Firma el PDF con PAdES B-B (PDF-066): devuelve el incremento a anexar. */
const signPdf: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const parsed = parseSignArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('firma: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, parsed.password ?? undefined);
  if (!opened.ok) return opened;
  const { openP12, buildSignatureUpdate } = await import('../../signature/digital');
  const identity = openP12(parsed.p12, parsed.p12Password);
  if (!identity.ok) return identity;
  const built = await buildSignatureUpdate({
    source,
    reader: opened.value,
    identity: identity.value,
    pageIndex: parsed.pageIndex,
    rect: parsed.rect,
    reason: parsed.reason,
    location: parsed.location,
    now: parsed.now,
  });
  if (!built.ok) return built;
  return ok({ delta: built.value.delta });
};

interface VerifyArgs {
  readonly password: string | null;
}

function parseVerifyArgs(args: unknown): VerifyArgs {
  if (typeof args !== 'object' || args === null || !('password' in args)) {
    throw new TypeError('verify-signatures: argumentos no válidos.');
  }
  const { password } = args;
  if (password !== null && typeof password !== 'string') throw new TypeError('verify-signatures: la contraseña debe ser texto o null.');
  return { password };
}

/** Valida las firmas del PDF (PDF-138): quién firmó, cuándo, si es íntegra y si hubo cambios después. */
const verifySignaturesOp: DocOp = async (args, ctx): Promise<Result<unknown, AppError>> => {
  const { password } = parseVerifyArgs(args);
  const source = ctx.sources[0];
  if (source === undefined) throw new RangeError('verify-signatures: falta el documento (fuente 0).');
  if (ctx.signal.aborted) return err(pdfError('cancelled'));
  const opened = await openForSave(source, password ?? undefined);
  if (!opened.ok) return opened;
  const { verifySignatures } = await import('../../signature/digital');
  return verifySignatures(source, opened.value);
};

export { p12Info, signPdf, verifySignaturesOp };
