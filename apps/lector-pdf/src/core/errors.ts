import type { AppError } from '@suite/shared';

export type PdfErrorCode =
  | 'empty'
  | 'not-pdf'
  | 'corrupt'
  | 'password-required'
  | 'password-incorrect'
  | 'io'
  | 'cancelled'
  | 'save-encrypted'
  | 'save-unreadable';

export const PDF_ERROR_MESSAGES: Readonly<Record<PdfErrorCode, string>> = {
  'empty': 'El fichero está vacío (0 bytes).',
  'not-pdf': 'Este fichero no es un PDF.',
  'corrupt': 'El PDF está dañado y no se puede abrir.',
  'password-required': 'Este PDF está protegido con contraseña. Abrir PDFs con contraseña llegará en una próxima versión.',
  'password-incorrect': 'La contraseña no es correcta.',
  'io': 'No se ha podido leer el fichero. Comprueba que sigue en su sitio.',
  'cancelled': 'Apertura cancelada.',
  'save-encrypted': 'No se pueden guardar anotaciones en este PDF porque está cifrado. Llegará en una próxima versión.',
  'save-unreadable': 'No se pueden guardar las anotaciones: la estructura interna del PDF está dañada.',
};

/** Crea un error de PDF con mensaje en español. `cause` conserva el error original para diagnóstico. */
export function pdfError(code: PdfErrorCode, cause?: unknown): AppError {
  const message = PDF_ERROR_MESSAGES[code];
  return cause === undefined ? { code, message } : { code, message, cause };
}
