import { afterEach, describe, expect, it } from 'vitest';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import { realTauriApi } from '../../src/tauri/tauri-api';

afterEach(() => {
  clearMocks();
});

const platformWith = (): ReturnType<typeof createTauriPlatform> =>
  createTauriPlatform({ prefsPrefix: 'test:' }, realTauriApi());

describe('createTauriPlatform · recientes', () => {
  it('openRecent devuelve un OpenedFile con ruta y guardado en sitio, como openFile', async () => {
    const commands: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      commands.push({ cmd, args });
      if (cmd !== 'suite_recent_open') throw new Error(`comando inesperado: ${cmd}`);
      return { token: 't7', name: 'informe.pdf', path: '/docs/informe.pdf', size: 2048, lastModified: 1700 };
    });

    const result = await platformWith().openRecent('r1-0');

    expect(commands).toEqual([{ cmd: 'suite_recent_open', args: { id: 'r1-0' } }]);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value).toMatchObject({
      token: 't7',
      name: 'informe.pdf',
      path: '/docs/informe.pdf',
      size: 2048,
      lastModified: 1700,
      canSaveInPlace: true,
    });
  });

  it('recentFiles traduce el campo available y conserva id, ruta y tamaño', async () => {
    mockIPC((cmd) => {
      if (cmd !== 'suite_recent_list') throw new Error(`comando inesperado: ${cmd}`);
      return [
        { id: 'r1-0', name: 'a.pdf', path: '/docs/a.pdf', size: 10, openedAt: 5, available: true },
        { id: 'r1-1', name: 'b.pdf', path: '/docs/b.pdf', size: null, openedAt: 4, available: false },
      ];
    });

    const files = await platformWith().recentFiles();

    expect(files).toEqual([
      { id: 'r1-0', name: 'a.pdf', path: '/docs/a.pdf', size: 10, openedAt: 5, available: true },
      { id: 'r1-1', name: 'b.pdf', path: '/docs/b.pdf', size: null, openedAt: 4, available: false },
    ]);
  });

  it('recentFiles devuelve lista vacía si el comando falla', async () => {
    mockIPC(() => {
      throw { code: 'io', message: 'carpeta de datos no disponible' };
    });

    const files = await platformWith().recentFiles();

    expect(files).toEqual([]);
  });

  it('openRecent con un id que ya no está en la lista devuelve err not-found', async () => {
    mockIPC(() => {
      throw { code: 'unknown-recent', message: 'Ese fichero ya no está en recientes.' };
    });

    const result = await platformWith().openRecent('r-desconocido');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
  });

  it('openRecent con una ruta borrada devuelve err not-found con la causa', async () => {
    mockIPC(() => {
      throw { code: 'not-found', message: 'No se encuentra el fichero.' };
    });

    const result = await platformWith().openRecent('r1-0');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('not-found');
    expect(result.error.cause).toEqual({ code: 'not-found', message: 'No se encuentra el fichero.' });
  });

  it('removeRecent y clearRecents invocan su comando con el id o sin argumentos', async () => {
    const commands: { cmd: string; args: unknown }[] = [];
    mockIPC((cmd, args) => {
      commands.push({ cmd, args });
      return undefined;
    });
    const platform = platformWith();

    await platform.removeRecent('r1-0');
    await platform.clearRecents();

    expect(commands).toEqual([
      { cmd: 'suite_recent_remove', args: { id: 'r1-0' } },
      { cmd: 'suite_recent_clear', args: {} },
    ]);
  });

  it('removeRecent y clearRecents no lanzan aunque el comando falle', async () => {
    mockIPC(() => {
      throw { code: 'io', message: 'No se ha podido guardar.' };
    });
    const platform = platformWith();

    await expect(platform.removeRecent('r1-0')).resolves.toBeUndefined();
    await expect(platform.clearRecents()).resolves.toBeUndefined();
  });
});
