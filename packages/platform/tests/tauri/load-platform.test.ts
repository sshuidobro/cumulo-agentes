import { afterEach, describe, expect, it } from 'vitest';
import { loadPlatform } from '../../src/detect';

const tauriGlobal = globalThis as unknown as { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  delete tauriGlobal.__TAURI_INTERNALS__;
});

describe('loadPlatform', () => {
  it('con __TAURI_INTERNALS__ definido devuelve la plataforma tauri', async () => {
    tauriGlobal.__TAURI_INTERNALS__ = {};

    const platform = await loadPlatform({ prefsPrefix: 'test:' });

    expect(platform.kind).toBe('tauri');
  });

  it('sin __TAURI_INTERNALS__ devuelve la plataforma web', async () => {
    const platform = await loadPlatform({ prefsPrefix: 'test:' });

    expect(platform.kind).toBe('web');
  });
});
