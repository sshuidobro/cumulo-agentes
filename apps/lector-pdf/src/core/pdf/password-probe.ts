/**
 * Sondeo previo a la carga (ADR-0043): decide si el PDF necesita contraseña de usuario antes de
 * abrirlo con pdf.js, para pedirla una sola vez y no reabrir el documento tras un intento fallido.
 */
import type { ByteSource } from '@suite/platform';
import { ObjectReader } from './object-reader';
import { PdfSyntaxError } from './objects';

/** `true` solo si el PDF tiene /Encrypt y la contraseña vacía no lo abre como usuario ni propietario. Nunca lanza. */
export async function needsUserPassword(src: ByteSource): Promise<boolean> {
  try { await ObjectReader.open(src); return false; }
  catch (e) { return e instanceof PdfSyntaxError && e.message === 'wrong-password'; }
}
