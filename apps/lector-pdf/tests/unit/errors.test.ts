import { describe, expect, it } from 'vitest';
import { PDF_ERROR_MESSAGES, pdfError, type PdfErrorCode } from '../../src/core/errors';

const CODES: readonly PdfErrorCode[] = ['empty', 'not-pdf', 'corrupt', 'password-required', 'password-incorrect', 'io', 'cancelled'];

describe('pdfError', () => {
  it('devuelve el código y el mensaje en español de cada error', () => {
    for (const code of CODES) {
      expect(pdfError(code)).toEqual({ code, message: PDF_ERROR_MESSAGES[code] });
    }
  });

  it('usa los textos acordados', () => {
    expect(PDF_ERROR_MESSAGES.empty).toBe('El fichero está vacío (0 bytes).');
    expect(PDF_ERROR_MESSAGES['not-pdf']).toBe('Este fichero no es un PDF.');
    expect(PDF_ERROR_MESSAGES.corrupt).toBe('El PDF está dañado y no se puede abrir.');
    expect(PDF_ERROR_MESSAGES['password-required']).toBe(
      'Este PDF está protegido con contraseña. Abrir PDFs con contraseña llegará en una próxima versión.',
    );
    expect(PDF_ERROR_MESSAGES['password-incorrect']).toBe('La contraseña no es correcta.');
    expect(PDF_ERROR_MESSAGES.io).toBe('No se ha podido leer el fichero. Comprueba que sigue en su sitio.');
    expect(PDF_ERROR_MESSAGES.cancelled).toBe('Apertura cancelada.');
  });

  it('conserva la causa original cuando se indica', () => {
    const cause = new Error('fallo de disco');
    const error = pdfError('io', cause);
    expect(error.code).toBe('io');
    expect(error.cause).toBe(cause);
  });

  it('no añade la propiedad cause si no hay causa', () => {
    expect(Object.keys(pdfError('empty'))).toEqual(['code', 'message']);
  });
});
