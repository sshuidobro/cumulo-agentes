import { describe, expect, it } from 'vitest';
import { parsePdfDate, toPdfDate } from '../../src/core/pdf-date';

describe('parsePdfDate', () => {
  it('fecha UTC completa', () => {
    expect(parsePdfDate('D:20261017120000Z')).toBe('2026-10-17T12:00:00.000Z');
  });

  it('convierte el desfase horario a UTC', () => {
    expect(parsePdfDate("D:20261017140000+02'00'")).toBe('2026-10-17T12:00:00.000Z');
    expect(parsePdfDate("D:20261017070000-05'00'")).toBe('2026-10-17T12:00:00.000Z');
  });

  it('acepta Z con cero de desfase explícito', () => {
    expect(parsePdfDate("D:20261017120000Z00'00'")).toBe('2026-10-17T12:00:00.000Z');
  });

  it('las partes que faltan valen su mínimo', () => {
    expect(parsePdfDate('D:2026')).toBe('2026-01-01T00:00:00.000Z');
    expect(parsePdfDate('D:202610')).toBe('2026-10-01T00:00:00.000Z');
    expect(parsePdfDate('D:20261017')).toBe('2026-10-17T00:00:00.000Z');
    expect(parsePdfDate('D:2026101712')).toBe('2026-10-17T12:00:00.000Z');
  });

  it('sin zona horaria se toma como UTC', () => {
    expect(parsePdfDate('D:20261017120000')).toBe('2026-10-17T12:00:00.000Z');
  });

  it('entradas inválidas devuelven null', () => {
    expect(parsePdfDate('basura')).toBeNull();
    expect(parsePdfDate('')).toBeNull();
    expect(parsePdfDate(null)).toBeNull();
    expect(parsePdfDate(undefined)).toBeNull();
    expect(parsePdfDate('D:20261317120000Z')).toBeNull(); // mes 13
    expect(parsePdfDate('D:20260231120000Z')).toBeNull(); // 31 de febrero
    expect(parsePdfDate('D:20261017250000Z')).toBeNull(); // hora 25
    expect(parsePdfDate('D:20261017126000Z')).toBeNull(); // segundos 60
    expect(parsePdfDate("D:20261017120000+25'00'")).toBeNull(); // desfase 25 h
    expect(parsePdfDate('D:2026101')).toBeNull(); // mes a medias
  });
});

describe('toPdfDate', () => {
  it('escribe UTC sin milisegundos', () => {
    expect(toPdfDate('2026-10-17T12:00:00.000Z')).toBe('D:20261017120000Z');
    expect(toPdfDate('2026-10-17T14:05:09.750+02:00')).toBe('D:20261017120509Z');
  });

  it('rellena con ceros', () => {
    expect(toPdfDate('2026-01-02T03:04:05.000Z')).toBe('D:20260102030405Z');
  });

  it('lanza RangeError con una fecha inválida', () => {
    expect(() => toPdfDate('no es fecha')).toThrow(RangeError);
  });

  it('parsePdfDate(toPdfDate(x)) === x para fechas sin milisegundos', () => {
    for (const x of ['2026-10-17T12:00:00.000Z', '1999-12-31T23:59:59.000Z', '2000-02-29T00:00:00.000Z']) {
      expect(parsePdfDate(toPdfDate(x))).toBe(x);
    }
  });
});
