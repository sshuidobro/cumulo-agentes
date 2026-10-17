import { describe, expect, it } from 'vitest';
import { isTauri } from '../src/index';

describe('isTauri', () => {
  it('es true si existe __TAURI_INTERNALS__ en el objeto global', () => {
    expect(isTauri({ __TAURI_INTERNALS__: {} })).toBe(true);
  });

  it('es false sin esa propiedad', () => {
    expect(isTauri({})).toBe(false);
  });

  it('en el entorno de pruebas (navegador simulado) es false', () => {
    expect(isTauri()).toBe(false);
  });
});
