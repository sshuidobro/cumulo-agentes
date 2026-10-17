import { describe, expect, it } from 'vitest';
import { PLATFORM_MESSAGES, PlatformIoError, platformError } from '../src/index';

describe('platformError', () => {
  it('devuelve el texto en español de la tabla para changed-on-disk', () => {
    expect(platformError('changed-on-disk').message).toBe(
      'El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como».',
    );
    expect(platformError('changed-on-disk').message).toBe(PLATFORM_MESSAGES['changed-on-disk']);
  });

  it('sin causa no incluye la clave cause', () => {
    const error = platformError('not-found');
    expect(error).toEqual({ code: 'not-found', message: PLATFORM_MESSAGES['not-found'] });
    expect(Object.keys(error)).not.toContain('cause');
  });

  it('con causa la incluye', () => {
    const cause = new Error('origen');
    const error = platformError('io', cause);
    expect(error.code).toBe('io');
    expect(error.cause).toBe(cause);
  });

  it('todos los códigos tienen mensaje no vacío', () => {
    for (const code of Object.keys(PLATFORM_MESSAGES)) {
      expect(PLATFORM_MESSAGES[code as keyof typeof PLATFORM_MESSAGES].length).toBeGreaterThan(0);
    }
  });
});

describe('PlatformIoError', () => {
  it('usa el mensaje de la tabla, el nombre y el código', () => {
    const error = new PlatformIoError('permission-denied');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('PlatformIoError');
    expect(error.code).toBe('permission-denied');
    expect(error.message).toBe(PLATFORM_MESSAGES['permission-denied']);
  });

  it('guarda la causa original en cause', () => {
    const cause = new Error('origen');
    expect(new PlatformIoError('io', { cause }).cause).toBe(cause);
  });
});
