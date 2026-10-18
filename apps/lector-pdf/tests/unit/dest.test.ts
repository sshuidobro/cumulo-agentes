import { describe, expect, it } from 'vitest';
import { destZoomMode, parseExplicitDest } from '../../src/core/dest';

const ref = { num: 5, gen: 0 };
const name = (n: string) => ({ name: n });

describe('parseExplicitDest', () => {
  it('XYZ lee left, top y zoom', () => {
    expect(parseExplicitDest([ref, name('XYZ'), 72, 500, 0])).toMatchObject({ kind: 'XYZ', left: 72, top: 500, zoom: 0 });
  });

  it('XYZ con null deja la coordenada en null', () => {
    expect(parseExplicitDest([ref, name('XYZ'), null, 500, 1.5])).toMatchObject({ left: null, top: 500, zoom: 1.5 });
  });

  it('FitH y FitBH leen solo top', () => {
    expect(parseExplicitDest([ref, name('FitH'), 792])).toMatchObject({ kind: 'FitH', top: 792, left: null, zoom: null });
    expect(parseExplicitDest([ref, name('FitBH'), 100])).toMatchObject({ kind: 'FitBH', top: 100 });
  });

  it('FitV y FitBV leen solo left', () => {
    expect(parseExplicitDest([ref, name('FitV'), 36])).toMatchObject({ kind: 'FitV', left: 36, top: null });
    expect(parseExplicitDest([ref, name('FitBV'), 36])).toMatchObject({ kind: 'FitBV', left: 36 });
  });

  it('FitR lee left y top (no bottom ni right)', () => {
    expect(parseExplicitDest([ref, name('FitR'), 10, 20, 300, 400])).toMatchObject({ kind: 'FitR', left: 10, top: 400 });
  });

  it('Fit y FitB no llevan coordenadas', () => {
    expect(parseExplicitDest([ref, name('Fit')])).toMatchObject({ kind: 'Fit', left: null, top: null, zoom: null });
    expect(parseExplicitDest([ref, name('FitB')])).toMatchObject({ kind: 'FitB' });
  });

  it('conserva la referencia de página tal cual', () => {
    expect(parseExplicitDest([ref, name('Fit')])?.pageRef).toBe(ref);
    expect(parseExplicitDest([3, name('Fit')])?.pageRef).toBe(3);
  });

  it('tipo desconocido es null', () => {
    expect(parseExplicitDest([ref, name('Raro')])).toBeNull();
    expect(parseExplicitDest([ref, 'XYZ'])).toBeNull();
    expect(parseExplicitDest([ref])).toBeNull();
  });

  it('valores no numéricos son null (destino no válido)', () => {
    expect(parseExplicitDest([ref, name('XYZ'), '72', 500, 0])).toBeNull();
    expect(parseExplicitDest([ref, name('FitH'), Number.NaN])).toBeNull();
    expect(parseExplicitDest([ref, name('FitR'), 1, 2, 3, {}])).toBeNull();
  });
});

describe('destZoomMode', () => {
  it('XYZ con zoom 0 no cambia el zoom', () => {
    const d = parseExplicitDest([ref, name('XYZ'), 72, 500, 0]);
    expect(d).not.toBeNull();
    if (d !== null) expect(destZoomMode(d)).toBeNull();
  });

  it('XYZ con zoom 1.5 pide zoom personalizado 1.5', () => {
    const d = parseExplicitDest([ref, name('XYZ'), 72, 500, 1.5]);
    expect(d).not.toBeNull();
    if (d !== null) expect(destZoomMode(d)).toEqual({ kind: 'custom', zoom: 1.5 });
  });

  it('Fit y FitB ajustan la página; FitH y FitBH ajustan el ancho; el resto no cambia el zoom', () => {
    const mode = (args: unknown[]) => {
      const d = parseExplicitDest([ref, ...args]);
      expect(d).not.toBeNull();
      return d === null ? undefined : destZoomMode(d);
    };
    expect(mode([name('Fit')])).toEqual({ kind: 'fit-page' });
    expect(mode([name('FitB')])).toEqual({ kind: 'fit-page' });
    expect(mode([name('FitH'), 792])).toEqual({ kind: 'fit-width' });
    expect(mode([name('FitBH'), 792])).toEqual({ kind: 'fit-width' });
    expect(mode([name('FitV'), 36])).toBeNull();
    expect(mode([name('FitR'), 1, 2, 3, 4])).toBeNull();
  });
});
