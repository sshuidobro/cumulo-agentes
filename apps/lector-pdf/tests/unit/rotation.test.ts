import { describe, expect, it } from 'vitest';
import { normalizeRotation } from '../../src/core/rotation';

describe('normalizeRotation', () => {
  it('deja las rotaciones válidas como están', () => {
    expect(normalizeRotation(0)).toBe(0);
    expect(normalizeRotation(90)).toBe(90);
    expect(normalizeRotation(180)).toBe(180);
    expect(normalizeRotation(270)).toBe(270);
  });

  it('usa el múltiplo de 90 más cercano', () => {
    expect(normalizeRotation(44)).toBe(0);
    expect(normalizeRotation(46)).toBe(90);
    expect(normalizeRotation(224)).toBe(180);
    expect(normalizeRotation(236)).toBe(270);
  });

  it('admite negativos y valores mayores que 360', () => {
    expect(normalizeRotation(-90)).toBe(270);
    expect(normalizeRotation(-180)).toBe(180);
    expect(normalizeRotation(-45)).toBe(0);
    expect(normalizeRotation(450)).toBe(90);
    expect(normalizeRotation(720)).toBe(0);
  });

  it('rechaza valores no finitos', () => {
    expect(() => normalizeRotation(Number.NaN)).toThrow(RangeError);
    expect(() => normalizeRotation(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});
