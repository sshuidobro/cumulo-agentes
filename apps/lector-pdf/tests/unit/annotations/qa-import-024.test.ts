import { describe, expect, it } from 'vitest';
import { importPageAnnotations } from '../../../src/core/annotations/import';

const FB = '2026-10-17T12:00:00.000Z';
const base = { id: '5R', subtype: 'Highlight', rect: [0, 0, 10, 10] };

describe('QA PDF-024 · importación hostil', () => {
  it('no lanza con basura en la lista ni con valores NaN/Infinity', () => {
    const junk = [null, undefined, 42, 'x', [], { ...base, rect: [NaN, 0, 1, 1] }, { ...base, opacity: Infinity }] as never;
    const p = importPageAnnotations(0, junk, FB);
    expect(p.supported).toEqual([]);
    expect(p.foreign).toHaveLength(2);
  });
  it('conserva Unicode, emojis y RTL en contenido y autor', () => {
    const s = 'Ñandú 😀 שלום مرحبا';
    const p = importPageAnnotations(
      2,
      [{ ...base, contentsObj: { str: s }, titleObj: { str: 'Ángel' } }],
      FB,
    );
    expect(p.supported[0]?.contents).toBe(s);
    expect(p.supported[0]?.author).toBe('Ángel');
    expect(p.supported[0]?.pageIndex).toBe(2);
  });
  it('rect invertido se normaliza y Hidden con otras banderas se ignora', () => {
    const p = importPageAnnotations(0, [{ ...base, rect: [10, 10, 0, 0] }, { ...base, id: '6R', annotationFlags: 2 | 4 }], FB);
    expect(p.supported).toHaveLength(1);
    expect(p.supported[0]?.rect).toEqual([0, 0, 10, 10]);
  });
  it('lista enorme de anotaciones se procesa rápido sin lanzar', () => {
    const many = Array.from({ length: 20000 }, (_, i) => ({ ...base, id: `${String(i + 1)}R` }));
    expect(importPageAnnotations(0, many, FB).supported).toHaveLength(20000);
  });
});
