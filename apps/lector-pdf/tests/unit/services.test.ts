import { describe, expect, it, vi } from 'vitest';

describe('services', () => {
  it('lanza si se piden antes de inicializarlas (es un bug del arranque)', async () => {
    vi.resetModules();
    const { services } = await import('../../src/state/services');
    expect(() => services()).toThrow('Servicios no inicializados');
  });
});
