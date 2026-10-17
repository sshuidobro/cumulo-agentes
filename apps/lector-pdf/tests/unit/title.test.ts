import { describe, expect, it } from 'vitest';
import { windowTitle } from '../../src/core/title';

describe('windowTitle', () => {
  it('sin documento muestra solo el nombre de la app', () => {
    expect(windowTitle(null, false)).toBe('Lector PDF');
  });

  it('con documento limpio muestra el fichero y la app', () => {
    expect(windowTitle('a.pdf', false)).toBe('a.pdf — Lector PDF');
  });

  it('con cambios sin guardar antepone la marca •', () => {
    expect(windowTitle('a.pdf', true)).toBe('• a.pdf — Lector PDF');
  });
});
