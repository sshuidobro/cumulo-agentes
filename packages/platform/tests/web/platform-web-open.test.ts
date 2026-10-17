import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import type { WebEnv } from '../../src/web/web-env';
import { loadPlatform } from '../../src/detect';
import { fakeEnv, fakeHandle, namedError } from './fakes';

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];
const ACCEPT_PDF = '.pdf,application/pdf';

function makeFile(bytes: number[], name = 'informe.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf', lastModified: 1_700_000_000_000 });
}

function platformWith(env: WebEnv) {
  return createWebPlatform({ prefsPrefix: 'test.' }, env);
}

afterEach(() => {
  vi.restoreAllMocks();
  document.title = '';
});

describe('abrir con File System Access (selector)', () => {
  it('devuelve el fichero con nombre, tamaño, sin ruta, canSaveInPlace y bytes legibles', async () => {
    const file = makeFile([1, 2, 3, 4, 5]);
    const handle = fakeHandle(file);
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => [handle]) });
    const result = await platformWith(env).openFile(PDF_FILTERS);

    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    const opened = result.value;
    expect(opened.name).toBe('informe.pdf');
    expect(opened.size).toBe(5);
    expect(opened.path).toBeNull();
    expect(opened.canSaveInPlace).toBe(true);
    expect(opened.lastModified).toBe(1_700_000_000_000);
    expect(Array.from(await opened.source.read(0, 5))).toEqual([1, 2, 3, 4, 5]);
  });

  it('pasa los filtros como tipos de selector con MIME y extensiones', async () => {
    const picker = vi.fn(async () => [fakeHandle(makeFile([]))]);
    await platformWith(fakeEnv({ showOpenFilePicker: picker })).openFile(PDF_FILTERS);

    expect(picker).toHaveBeenCalledWith({
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
      excludeAcceptAllOption: false,
      multiple: false,
    });
  });

  it('cancelar el selector (AbortError) devuelve ok(null)', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => { throw namedError('AbortError'); }) });
    expect(await platformWith(env).openFile(PDF_FILTERS)).toEqual({ ok: true, value: null });
  });

  it('NotAllowedError se traduce a permission-denied', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => { throw namedError('NotAllowedError'); }) });
    const result = await platformWith(env).openFile(PDF_FILTERS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('se esperaba error');
    expect(result.error.code).toBe('permission-denied');
  });

  it('TypeError se traduce a io', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => { throw new TypeError('roto'); }) });
    const result = await platformWith(env).openFile(PDF_FILTERS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('se esperaba error');
    expect(result.error.code).toBe('io');
  });

  it('un fallo al leer el handle (getFile) también se traduce', async () => {
    const broken = { kind: 'file', name: 'x.pdf', getFile: async () => { throw namedError('NotAllowedError'); } } as unknown as FileSystemFileHandle;
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => [broken]) });
    const result = await platformWith(env).openFile(PDF_FILTERS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('se esperaba error');
    expect(result.error.code).toBe('permission-denied');
  });

  it('un selector que no devuelve ningún handle es ok(null)', async () => {
    const env = fakeEnv({ showOpenFilePicker: vi.fn(async () => []) });
    expect(await platformWith(env).openFile(PDF_FILTERS)).toEqual({ ok: true, value: null });
  });
});

describe('abrir sin File System Access (input type=file)', () => {
  it('llama a pickWithInput con el atributo accept de los filtros', async () => {
    const pickWithInput = vi.fn(async (): Promise<File | null> => null);
    const result = await platformWith(fakeEnv({ pickWithInput })).openFile(PDF_FILTERS);

    expect(pickWithInput).toHaveBeenCalledWith(ACCEPT_PDF);
    expect(result).toEqual({ ok: true, value: null });
  });

  it('con un fichero elegido devuelve canSaveInPlace false', async () => {
    const env = fakeEnv({ pickWithInput: vi.fn(async () => makeFile([9, 8])) });
    const result = await platformWith(env).openFile(PDF_FILTERS);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(false);
    expect(result.value.size).toBe(2);
  });

  it('un fallo del input se devuelve como io', async () => {
    const env = fakeEnv({ pickWithInput: vi.fn(async () => { throw new Error('boom'); }) });
    const result = await platformWith(env).openFile(PDF_FILTERS);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('se esperaba error');
    expect(result.error.code).toBe('io');
  });
});

describe('openBrowserFile y openDropped', () => {
  it('openDropped con getAsFileSystemHandle devuelve canSaveInPlace true', async () => {
    const file = makeFile([1]);
    const dt = {
      items: [{ getAsFileSystemHandle: async () => fakeHandle(file) }],
      files: [],
    } as unknown as DataTransfer;
    const result = await platformWith(fakeEnv()).openDropped(dt);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(true);
    expect(result.value.name).toBe('informe.pdf');
  });

  it('openDropped con solo files devuelve canSaveInPlace false', async () => {
    const dt = { items: [{}], files: [makeFile([1, 2, 3])] } as unknown as DataTransfer;
    const result = await platformWith(fakeEnv()).openDropped(dt);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(false);
    expect(result.value.size).toBe(3);
  });

  it('openDropped sin ficheros devuelve ok(null)', async () => {
    const dt = { items: [], files: [] } as unknown as DataTransfer;
    expect(await platformWith(fakeEnv()).openDropped(dt)).toEqual({ ok: true, value: null });
  });

  it('openDropped cae a files si el handle soltado es una carpeta', async () => {
    const folder = { kind: 'directory', name: 'carpeta' } as unknown as FileSystemFileHandle;
    const dt = {
      items: [{ getAsFileSystemHandle: async () => folder }],
      files: [makeFile([1])],
    } as unknown as DataTransfer;
    const result = await platformWith(fakeEnv()).openDropped(dt);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(false);
  });

  it('openDropped cae a files si getAsFileSystemHandle rechaza', async () => {
    const dt = {
      items: [{ getAsFileSystemHandle: async () => { throw new Error('no disponible'); } }],
      files: [makeFile([1])],
    } as unknown as DataTransfer;
    const result = await platformWith(fakeEnv()).openDropped(dt);
    expect(result.ok).toBe(true);
    if (!result.ok || result.value === null) throw new Error('se esperaba un fichero');
    expect(result.value.canSaveInPlace).toBe(false);
  });

  it('openBrowserFile devuelve canSaveInPlace false y ok', () => {
    const result = platformWith(fakeEnv()).openBrowserFile(makeFile([1]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('se esperaba ok');
    expect(result.value.canSaveInPlace).toBe(false);
  });

  it('dos aperturas dan tokens distintos', () => {
    const platform = platformWith(fakeEnv());
    const first = platform.openBrowserFile(makeFile([1]));
    const second = platform.openBrowserFile(makeFile([2]));
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error('se esperaba ok');
    expect(first.value.token).not.toBe(second.value.token);
  });
});

describe('openExternalUrl', () => {
  it('https abre con noopener,noreferrer', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const result = await platformWith(fakeEnv()).openExternalUrl('https://example.org');
    expect(result.ok).toBe(true);
    expect(open).toHaveBeenCalledWith('https://example.org', '_blank', 'noopener,noreferrer');
  });

  it('mailto también se permite', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const result = await platformWith(fakeEnv()).openExternalUrl('mailto:a@example.org');
    expect(result.ok).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'no es url'])(
    'rechaza %s sin abrir nada',
    async (url) => {
      const open = vi.spyOn(window, 'open').mockImplementation(() => null);
      const result = await platformWith(fakeEnv()).openExternalUrl(url);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error('se esperaba error');
      expect(result.error.code).toBe('unsupported');
      expect(open).not.toHaveBeenCalled();
    },
  );
});

describe('ventana, cierre y operaciones pendientes', () => {
  it('setTitle cambia document.title', () => {
    platformWith(fakeEnv()).setTitle('a.pdf — Lector PDF');
    expect(document.title).toBe('a.pdf — Lector PDF');
  });

  it('onCloseRequested con false cancela el cierre (defaultPrevented)', () => {
    const platform = platformWith(fakeEnv());
    const stop = platform.onCloseRequested(() => false);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    stop();
  });

  it('onCloseRequested con true permite el cierre', () => {
    const platform = platformWith(fakeEnv());
    const stop = platform.onCloseRequested(() => true);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    stop();
  });

  it('tras darse de baja no se llama al callback', () => {
    const cb = vi.fn(() => false);
    const platform = platformWith(fakeEnv());
    const stop = platform.onCloseRequested(cb);
    stop();
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(cb).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('save y saveAs son unsupported hasta COM-007', async () => {
    const platform = platformWith(fakeEnv());
    const file = platform.openBrowserFile(makeFile([1]));
    if (!file.ok) throw new Error('se esperaba ok');
    const data = { kind: 'bytes', bytes: new Uint8Array([1]) } as const;
    expect(await platform.save(file.value, data)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
    expect(await platform.saveAs('a.pdf', PDF_FILTERS, data)).toMatchObject({ ok: false, error: { code: 'unsupported' } });
  });

  it('closeFile no lanza y onFileOpenedFromOS devuelve una baja vacía', async () => {
    const platform = platformWith(fakeEnv());
    const file = platform.openBrowserFile(makeFile([1]));
    if (!file.ok) throw new Error('se esperaba ok');
    await expect(platform.closeFile(file.value)).resolves.toBeUndefined();
    expect(platform.onFileOpenedFromOS(() => undefined)).toEqual(expect.any(Function));
  });

  it('se identifica como web y con prefijo de preferencias', () => {
    const platform = platformWith(fakeEnv());
    expect(platform.kind).toBe('web');
    expect(platform.isMac).toBe(false);
    expect(platform.prefs.get('nada', (v): v is string => typeof v === 'string')).toBeNull();
  });

  it('loadPlatform devuelve la plataforma web en el navegador simulado', async () => {
    const platform = await loadPlatform({ prefsPrefix: 'test.' });
    expect(platform.kind).toBe('web');
  });
});
