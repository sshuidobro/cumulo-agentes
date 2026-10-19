import type { AppError } from '@suite/shared';

export type PdfErrorCode =
  | 'empty'
  | 'not-pdf'
  | 'corrupt'
  | 'password-required'
  | 'password-incorrect'
  | 'io'
  | 'cancelled'
  | 'save-wrong-password'
  | 'save-encryption-unsupported'
  | 'save-unreadable'
  | 'invalid-image';

export const PDF_ERROR_MESSAGES: Readonly<Record<PdfErrorCode, string>> = {
  'empty': 'El fichero está vacío (0 bytes).',
  'not-pdf': 'Este fichero no es un PDF.',
  'corrupt': 'El PDF está dañado y no se puede abrir.',
  'password-required': 'Este PDF está protegido con contraseña.',
  'password-incorrect': 'La contraseña no es correcta.',
  'io': 'No se ha podido leer el fichero. Comprueba que sigue en su sitio.',
  'cancelled': 'Apertura cancelada.',
  'save-wrong-password': 'No se pueden guardar los cambios: la contraseña no es correcta.',
  'save-encryption-unsupported': 'Este PDF usa un cifrado que no se puede modificar.',
  'save-unreadable': 'No se pueden guardar los cambios: la estructura interna del PDF está dañada.',
  'invalid-image': 'La imagen no es válida o no está en un formato admitido (PNG o JPEG).',
};

/** Crea un error de PDF con mensaje en español. `cause` conserva el error original para diagnóstico. */
export function pdfError(code: PdfErrorCode, cause?: unknown): AppError {
  const message = PDF_ERROR_MESSAGES[code];
  return cause === undefined ? { code, message } : { code, message, cause };
}
