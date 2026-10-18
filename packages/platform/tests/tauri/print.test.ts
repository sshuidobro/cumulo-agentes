import { afterEach, describe, expect, it } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import { realTauriApi } from '../../src/tauri/tauri-api';

afterEach(() => {
  clearMocks();
});

describe('createTauriPlatform · print', () => {
  it('invoca el comando suite_print una vez y devuelve ok', async () => {
    const commands: string[] = [];
    mockIPC((cmd) => {
      commands.push(cmd);
      return undefined;
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, realTauriApi());

    const result = await platform.print();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(commands).toEqual(['suite_print']);
  });

  it('si el comando falla, devuelve err de tipo io con la causa', async () => {
    mockIPC((cmd) => {
      if (cmd !== 'suite_print') throw new Error(`comando inesperado: ${cmd}`);
      throw 'No se ha podido abrir la impresión: webview cerrado';
    });
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, realTauriApi());

    const result = await platform.print();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
    expect(result.error.cause).toBe('No se ha podido abrir la impresión: webview cerrado');
  });
});
