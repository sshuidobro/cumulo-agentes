import { createLogger, type Result } from '@suite/shared';
import { bytesSource } from '../core/doc-ops/bytes';
import type { PageRotation } from '../core/pdf/page-tree';
import { loadPdf, type LoadedPdf } from '../engine';
import { organizeMsg } from '../ui/messages-organize';
import { runDocOp } from './doc-ops';
import { showNotice } from './notice';
import { askPassword } from './password-prompt';
import { services } from './services';

const log = createLogger('import-pdf');

/** Códigos de `page-rotations` que significan «hace falta contraseña» (o la que se dio no vale). */
const PASSWORD_CODES: ReadonlySet<string> = new Set(['save-wrong-password', 'password-required', 'password-incorrect']);

/** Resultado de comprobar un PDF importado (PDF-128). */
export type ImportCheck =
  | { readonly kind: 'ok'; readonly password: string | null; readonly rotations: readonly PageRotation[] }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'failed' };

/**
 * Comprueba que un PDF importado se puede leer: lee sus giros con `page-rotations`. Si está protegido pide la
 * contraseña con `askPassword` (solo vive en la sesión). `cancelled` si el usuario la cancela; `failed` si no es un
 * PDF legible o no tiene páginas (en ese caso ya se ha avisado). Nunca lanza.
 */
export async function checkImport(name: string, bytes: Uint8Array): Promise<ImportCheck> {
  let password: string | null = null;
  for (;;) {
    const result = await runDocOp<readonly PageRotation[]>('page-rotations', { password }, [bytes]);
    if (result.ok) {
      if (result.value.length === 0) {
        showNotice(organizeMsg.importFailed(name));
        return { kind: 'failed' };
      }
      return { kind: 'ok', password, rotations: result.value };
    }
    if (!PASSWORD_CODES.has(result.error.code)) {
      log.warn('check', result.error.code);
      showNotice(organizeMsg.importFailed(name));
      return { kind: 'failed' };
    }
    const entered = await askPassword(name, password !== null);
    if (entered === null) return { kind: 'cancelled' };
    password = entered;
  }
}

/** Abre un PDF importado con pdf.js (para las miniaturas). `password` es la que ya se comprobó con `checkImport`. */
export function loadImport(bytes: Uint8Array, password: string | null): Promise<Result<LoadedPdf>> {
  const { assetBaseUrl } = services();
  return loadPdf(bytesSource(bytes), { assetBaseUrl, ...(password === null ? {} : { password }) });
}
