import { describe, expect, it } from 'vitest';
import { PageDimsTable } from '../../src/core/page-dims';
import type { Rotation } from '../../src/core/rotation';

describe('PageDimsTable.uniform', () => {
  it('guarda el mismo tamaño y rotación en todas las páginas, todas conocidas', () => {
    const t = PageDimsTable.uniform(3, 612, 792, 90);
    expect(t.count).toBe(3);
    expect(t.width(2)).toBe(612);
    expect(t.height(0)).toBe(792);
    expect(t.rotation(1)).toBe(90);
    expect(t.isKnown(0)).toBe(true);
    expect(t.version).toBe(0);
  });

  it('admite cero páginas', () => {
    expect(PageDimsTable.uniform(0, 612, 792, 0).count).toBe(0);
  });

  it('rechaza un número de páginas negativo o no entero', () => {
    expect(() => PageDimsTable.uniform(-1, 612, 792, 0)).toThrow(RangeError);
    expect(() => PageDimsTable.uniform(1.5, 612, 792, 0)).toThrow(RangeError);
  });

  it('rechaza tamaños negativos o no finitos', () => {
    expect(() => PageDimsTable.uniform(1, -1, 792, 0)).toThrow(RangeError);
    expect(() => PageDimsTable.uniform(1, 612, Number.NaN, 0)).toThrow(RangeError);
  });

  it('rechaza una rotación que no es múltiplo de 90 válido', () => {
    const bad: number = 45;
    expect(() => PageDimsTable.uniform(1, 612, 792, bad as Rotation)).toThrow(RangeError);
  });
});

describe('PageDimsTable sin conocer', () => {
  it('las páginas nuevas no están marcadas como conocidas', () => {
    const t = new PageDimsTable(2);
    expect(t.count).toBe(2);
    expect(t.isKnown(0)).toBe(false);
    expect(t.isKnown(1)).toBe(false);
    expect(t.version).toBe(0);
  });

  it('una tabla sin páginas es válida', () => {
    expect(new PageDimsTable(0).count).toBe(0);
  });

  it('rechaza un número de páginas inválido', () => {
    expect(() => new PageDimsTable(-3)).toThrow(RangeError);
  });
});

describe('PageDimsTable.set', () => {
  it('marca la página como conocida y sube la versión al cambiar algo', () => {
    const t = new PageDimsTable(2);
    expect(t.set(1, 300, 400, 0)).toBe(true);
    expect(t.isKnown(1)).toBe(true);
    expect(t.isKnown(0)).toBe(false);
    expect(t.width(1)).toBe(300);
    expect(t.height(1)).toBe(400);
    expect(t.rotation(1)).toBe(0);
    expect(t.version).toBe(1);
  });

  it('devuelve false y no sube la versión si el valor no cambia', () => {
    const t = PageDimsTable.uniform(2, 612, 792, 0);
    expect(t.set(0, 612, 792, 0)).toBe(false);
    expect(t.version).toBe(0);
  });

  it('devuelve false si se repite un valor fraccionario (misma precisión de almacenamiento)', () => {
    const t = new PageDimsTable(1);
    expect(t.set(0, 612.1, 792.3, 0)).toBe(true);
    expect(t.set(0, 612.1, 792.3, 0)).toBe(false);
    expect(t.version).toBe(1);
  });

  it('cambiar solo la rotación cuenta como cambio', () => {
    const t = PageDimsTable.uniform(1, 612, 792, 0);
    expect(t.set(0, 612, 792, 90)).toBe(true);
    expect(t.rotation(0)).toBe(90);
    expect(t.version).toBe(1);
  });

  it('lanza RangeError con índices fuera de rango, sin modificar la tabla', () => {
    const t = PageDimsTable.uniform(2, 612, 792, 0);
    expect(() => t.set(2, 1, 1, 0)).toThrow(RangeError);
    expect(() => t.set(-1, 1, 1, 0)).toThrow(RangeError);
    expect(() => t.set(0.5, 1, 1, 0)).toThrow(RangeError);
    expect(t.version).toBe(0);
    expect(t.width(0)).toBe(612);
  });

  it('lanza RangeError al leer un índice fuera de rango', () => {
    const t = PageDimsTable.uniform(2, 612, 792, 0);
    expect(() => t.width(2)).toThrow(RangeError);
    expect(() => t.height(-1)).toThrow(RangeError);
    expect(() => t.rotation(5)).toThrow(RangeError);
    expect(() => t.isKnown(2)).toThrow(RangeError);
  });

  it('rechaza valores inválidos al escribir', () => {
    const t = PageDimsTable.uniform(1, 612, 792, 0);
    const bad: number = 180.5;
    expect(() => t.set(0, -5, 792, 0)).toThrow(RangeError);
    expect(() => t.set(0, 612, Number.POSITIVE_INFINITY, 0)).toThrow(RangeError);
    expect(() => t.set(0, 612, 792, bad as Rotation)).toThrow(RangeError);
  });
});
