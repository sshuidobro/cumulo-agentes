import type { AppError } from '@suite/shared';
import { pdfError } from '../errors';
import { PdfSyntaxError } from './objects';

/** Error de guardado (`Result`) a partir de un fallo de lectura o escritura. Lo comparten los escritores de PDF. */
export function toSaveError(error: unknown): AppError {
  if (error instanceof PdfSyntaxError && error.message === 'wrong-password') return pdfError('save-wrong-password', error);
  if (error instanceof PdfSyntaxError && error.message === 'encryption-unsupported') {
    return pdfError('save-encryption-unsupported', error);
  }
  return pdfError('save-unreadable', error);
}
