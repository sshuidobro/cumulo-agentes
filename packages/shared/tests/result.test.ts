import { describe, expect, expectTypeOf, it } from 'vitest';
import { err, ok } from '../src/index';
import type { AppError, Result } from '../src/index';

describe('Result', () => {
  it('ok(valor) produce { ok: true, value }', () => {
    expect(ok(3)).toEqual({ ok: true, value: 3 });
  });

  it('err(error) produce { ok: false, error }', () => {
    const error: AppError = { code: 'x', message: 'y' };
    expect(err(error)).toEqual({ ok: false, error: { code: 'x', message: 'y' } });
  });

  it('un switch sobre r.ok estrecha el tipo', () => {
    const parse = (n: number): Result<number, AppError> =>
      n > 0 ? ok(n) : err({ code: 'negativo', message: 'Debe ser positivo' });

    const describeResult = (r: Result<number, AppError>): string => {
      switch (r.ok) {
        case true:
          expectTypeOf(r.value).toEqualTypeOf<number>();
          return `valor ${r.value}`;
        case false:
          expectTypeOf(r.error).toEqualTypeOf<AppError>();
          return `error ${r.error.code}`;
      }
    };

    expect(describeResult(parse(2))).toBe('valor 2');
    expect(describeResult(parse(-1))).toBe('error negativo');
  });
});
