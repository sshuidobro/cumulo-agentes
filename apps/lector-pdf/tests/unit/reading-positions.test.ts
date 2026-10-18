import { describe, expect, it } from 'vitest';
import {
  emptyPositions,
  isPositionsState,
  lookupPosition,
  MAX_POSITIONS,
  rememberPosition,
  type PositionsState,
  type ReadingPosition,
} from '../../src/core/reading-positions';

const POS: ReadingPosition = {
  page: 41,
  yFraction: 0.25,
  zoomMode: { kind: 'fit-page' },
  rotation: 90,
  updatedAt: 1_700_000_000_000,
};

function withDocuments(count: number): PositionsState {
  let state = emptyPositions();
  for (let i = 0; i < count; i++) {
    state = rememberPosition(state, `doc-${i}`, { ...POS, page: i });
  }
  return state;
}

describe('rememberPosition y lookupPosition', () => {
  it('con 501 documentos distintos deja 500 y elimina el más antiguo', () => {
    const state = withDocuments(MAX_POSITIONS + 1);

    expect(state.entries).toHaveLength(MAX_POSITIONS);
    expect(lookupPosition(state, 'doc-0')).toBeNull();
    expect(lookupPosition(state, 'doc-1')?.page).toBe(1);
    expect(lookupPosition(state, `doc-${MAX_POSITIONS}`)?.page).toBe(MAX_POSITIONS);
  });

  it('recordar un documento existente lo mueve al final sin duplicarlo', () => {
    const state = withDocuments(3);
    const updated = rememberPosition(state, 'doc-0', { ...POS, page: 7 });

    expect(updated.entries.map(([key]) => key)).toEqual(['doc-1', 'doc-2', 'doc-0']);
    expect(lookupPosition(updated, 'doc-0')?.page).toBe(7);
  });

  it('no modifica el estado original', () => {
    const state = withDocuments(2);
    const before = JSON.stringify(state);
    rememberPosition(state, 'doc-0', { ...POS, page: 9 });
    expect(JSON.stringify(state)).toBe(before);
  });

  it('lookupPosition devuelve null para una huella desconocida', () => {
    expect(lookupPosition(emptyPositions(), 'nadie')).toBeNull();
  });

  it('guarda solo página, fracción, zoom, rotación y fecha (sin nombre ni ruta)', () => {
    const leaky = { ...POS, path: '/home/usuario/informe.pdf', name: 'informe.pdf' };
    const state = rememberPosition(emptyPositions(), 'fp-1', leaky);
    const stored = lookupPosition(state, 'fp-1');

    expect(Object.keys(stored ?? {}).sort()).toEqual(['page', 'rotation', 'updatedAt', 'yFraction', 'zoomMode']);
    expect(JSON.stringify(state)).not.toContain('informe');
    expect(JSON.stringify(state)).not.toContain('/home');
  });

  it('copia el zoom personalizado para no compartir el objeto con el llamante', () => {
    const zoomMode = { kind: 'custom' as const, zoom: 1.5 };
    const state = rememberPosition(emptyPositions(), 'fp', { ...POS, zoomMode });
    zoomMode.zoom = 3;
    expect(lookupPosition(state, 'fp')?.zoomMode).toEqual({ kind: 'custom', zoom: 1.5 });
  });
});

describe('isPositionsState', () => {
  it('acepta un estado válido', () => {
    const state = rememberPosition(emptyPositions(), 'fp', POS);
    expect(isPositionsState(state)).toBe(true);
    expect(isPositionsState(emptyPositions())).toBe(true);
  });

  it('rechaza null, versión 2, rotación 45, página -1 y zoom personalizado no numérico', () => {
    expect(isPositionsState(null)).toBe(false);
    expect(isPositionsState({ version: 2, entries: [] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp', { ...POS, rotation: 45 }]] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp', { ...POS, page: -1 }]] })).toBe(false);
    expect(
      isPositionsState({ version: 1, entries: [['fp', { ...POS, zoomMode: { kind: 'custom', zoom: 'x' } }]] }),
    ).toBe(false);
  });

  it('rechaza entradas mal formadas, fracciones fuera de [0, 1] y modos de zoom desconocidos', () => {
    expect(isPositionsState({ version: 1, entries: 'no' })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp']] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [[7, POS]] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp', { ...POS, yFraction: 1.5 }]] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp', { ...POS, yFraction: Number.NaN }]] })).toBe(false);
    expect(isPositionsState({ version: 1, entries: [['fp', { ...POS, zoomMode: { kind: 'warp' } }]] })).toBe(false);
  });
});
