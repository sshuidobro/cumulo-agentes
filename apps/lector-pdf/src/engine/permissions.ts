import { createLogger } from '@suite/shared';
import type { ByteSource } from '@suite/platform';
import { cipherKindOf, type CipherKind } from '../core/permissions';
import type { PDFDocumentProxy } from './pdfjs';

const log = createLogger('permissions');

/**
 * Banderas de permisos de `/P` del documento, o `null` si no tiene restricciones. Nunca lanza: un error de lectura
 * se trata como «sin restricciones» y se anota en el registro.
 */
export async function readPermissions(doc: PDFDocumentProxy): Promise<ReadonlySet<number> | null> {
  try {
    return (await doc.getPermissions()) ?? null;
  } catch (cause) {
    log.warn('getPermissions', cause);
    return null;
  }
}

/**
 * Cifrado del fichero (PDF-048, pestaña Seguridad). Se abre con `password` (la vacía si el PDF solo tiene
 * contraseña de propietario). Devuelve `null` si no se puede leer. Nunca lanza.
 */
export async function readCipher(source: ByteSource, password: string): Promise<CipherKind | null> {
  // Escritor de incrementos en diferido (PDF-140): no entra en el arranque.
  const { openForSave } = await import('../core/pdf/incremental');
  const opened = await openForSave(source, password);
  if (!opened.ok) {
    log.warn('readCipher', opened.error.code);
    return null;
  }
  const reader = opened.value;
  return reader.encryptRef === null ? 'none' : cipherKindOf(reader.security);
}
