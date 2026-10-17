// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import type { Result } from '@suite/shared';
import { createWebPlatform } from '../../src/web/platform-web';
import type { WebEnv } from '../../src/web/web-env';
import type { OpenedFile, SaveData } from '../../src/types';
import { fakeEnv, namedError } from './fakes';

const PDF_FILTERS = [{ name: 'PDF', extensions: ['pdf'] }];

interface WriteRecord {
  readonly parts: unknown[];
  closed: boolean;
  aborted: boolean;
}

interface FakeOptions {
  readonly query?: PermissionState;
  readonly request?: PermissionState;
  readonly noPermissionApi?: boolean;
  /** Número de llamada a write() que lanza (1 = la primera). */
  readonly failWriteAt?: number;
  readonly createError?: Error;
  readonly abortError?: Error;
}

/** Concatena los trozos escritos (Blob o Uint8Array) en el orden en que llegaron. */
async function readParts(parts: readonly unknown[]): Promise<Uint8Array<ArrayBuffer>> {
  const chunks: Uint8Array[] = [];
  for (const part of parts) {
    if (part instanceof Blob) chunks.push(new Uint8Array(await part.arrayBuffer()));
    else if (part instanceof Uint8Array) chunks.push(part);
    else throw new TypeError('trozo desconocido');
  }
  const out = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/**
 * Handle falso de File System Access con disco en memoria. Como Chromium, el contenido
 * solo cambia en close(); si hay abort() o error, el disco conserva el original.
 */
function fakeDiskHandle(initial: File, options: FakeOptions = {}) {
  const disk: { file: File } = { file: initial };
  const records: WriteRecord[] = [];
  const queryPermission = vi.fn(async (): Promise<PermissionState> => options.query ?? 'granted');
  const requestPermission = vi.fn(async (): Promise<PermissionState> => options.request ?? 'granted');
  const createWritable = vi.fn(async (): Promise<FileSystemWritableFileStream> => {
    if (options.createError !== undefined) throw options.createError;
    const record: WriteRecord = { parts: [], closed: false, aborted: false };
    records.push(record);
    let writeCalls = 0;
    const writable = {
      async write(data: unknown): Promise<void> {
        writeCalls += 1;
        if (writeCalls === options.failWriteAt) throw new Error('disco lleno');
        record.parts.push(data);
      },
      async close(): Promise<void> {
        const bytes = await readParts(record.parts);
        disk.file = new File([bytes], initial.name, { lastModified: 1_800_000_000_000 });
        record.closed = true;
      },
      async abort(): Promise<void> {
        record.aborted = true;
        if (options.abortError !== undefined) throw options.abortError;
      },
    };
    return writable as unknown as FileSystemWritableFileStream;
  });
  const permissions = options.noPermissionApi === true ? {} : { queryPermission, requestPermission };
  const handle = {
    kind: 'file',
    name: initial.name,
    getFile: vi.fn(async () => disk.file),
    createWritable,
    ...permissions,
  };
  return {
    handle: handle as unknown as FileSystemFileHandle,
    disk,
    records,
    createWritable,
    queryPermission,
    requestPermission,
  };
}

function makeFile(bytes: number[], name = 'informe.pdf'): File {
  return new File([new Uint8Array(bytes)], name, { type: 'application/pdf', lastModified: 1_700_000_000_000 });
}

function bytesData(bytes: number[]): SaveData {
  return { kind: 'bytes', bytes: new Uint8Array(bytes) };
}

function codeOf(result: Result<unknown>): string | undefined {
  return result.ok ? undefined : result.error.code;
}

/** Abre `handle` con la plataforma web (selector de File System Access) y devuelve el fichero abierto. */
async function openWithHandle(handle: FileSystemFileHandle, overrides: Partial<WebEnv> = {}) {
  const env = fakeEnv({ showOpenFilePicker: async () => [handle], ...overrides });
  const platform = createWebPlatform({ prefsPrefix: 'save.' }, env);
  const opened = await platform.openFile(PDF_FILTERS);
  if (!opened.ok || opened.value === null) throw new Error('se esperaba un fichero abierto');
  return { platform, env, file: opened.value };
}

async function readOpened(file: OpenedFile): Promise<number[]> {
  return Array.from(await file.source.read(0, file.size));
}

describe('save con File System Access', () => {
  it('bytes: el disco queda con el contenido nuevo y el OpenedFile conserva token, con tamaño y origen nuevos', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]));
    const { platform, file } = await openWithHandle(disk.handle);

    const result = await platform.save(file, bytesData([9, 9]));

    expect(Array.from(new Uint8Array(await disk.disk.file.arrayBuffer()))).toEqual([9, 9]);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('se esperaba ok');
    expect(result.value.token).toBe(file.token);
    expect(result.value.size).toBe(2);
    expect(await readOpened(result.value)).toEqual([9, 9]);
    expect(result.value.canSaveInPlace).toBe(true);
  });

  it('append sobre sí mismo: [1,2,3] + [4,5] queda como [1,2,3,4,5]', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]));
    const { platform, file } = await openWithHandle(disk.handle);

    const result = await platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: 3,
      delta: new Uint8Array([4, 5]),
    });

    expect(result.ok).toBe(true);
    expect(await readParts(disk.records[0]?.parts ?? [])).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    if (!result.ok) throw new Error('se esperaba ok');
    expect(result.value.size).toBe(5);
    expect(await readOpened(result.value)).toEqual([1, 2, 3, 4, 5]);
  });

  it('append con expectedSize distinto del tamaño actual → changed-on-disk y no se escribe nada', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]));
    const { platform, file } = await openWithHandle(disk.handle);

    const result = await platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: 5,
      delta: new Uint8Array([4, 5]),
    });

    expect(codeOf(result)).toBe('changed-on-disk');
    expect(disk.createWritable).not.toHaveBeenCalled();
    expect(await readOpened(file)).toEqual([1, 2, 3]);
  });

  it('append cuyo original cambió en disco desde la apertura → changed-on-disk aunque el registro diga lo contrario', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]));
    const { platform, file } = await openWithHandle(disk.handle);
    disk.disk.file = makeFile([7, 7, 7, 7]);

    const result = await platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: 3,
      delta: new Uint8Array([4]),
    });

    expect(codeOf(result)).toBe('changed-on-disk');
    expect(disk.createWritable).not.toHaveBeenCalled();
  });

  it('fallo en write() → abort(), error io y el contenido visible sigue siendo el original', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]), { failWriteAt: 1 });
    const { platform, file } = await openWithHandle(disk.handle);

    const result = await platform.save(file, bytesData([9, 9]));

    expect(codeOf(result)).toBe('io');
    expect(disk.records[0]?.aborted).toBe(true);
    expect(disk.records[0]?.closed).toBe(false);
    expect(Array.from(new Uint8Array(await disk.disk.file.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('fallo en el segundo write() de un append → abort() y el original sin cambios', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2, 3]), { failWriteAt: 2 });
    const { platform, file } = await openWithHandle(disk.handle);

    const result = await platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: 3,
      delta: new Uint8Array([4, 5]),
    });

    expect(codeOf(result)).toBe('io');
    expect(disk.records[0]?.aborted).toBe(true);
    expect(Array.from(new Uint8Array(await disk.disk.file.arrayBuffer()))).toEqual([1, 2, 3]);
  });

  it('si abort() también falla, el error devuelto sigue siendo io', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { failWriteAt: 1, abortError: new Error('no se puede abortar') });
    const { platform, file } = await openWithHandle(disk.handle);

    expect(codeOf(await platform.save(file, bytesData([2])))).toBe('io');
    expect(disk.records[0]?.aborted).toBe(true);
  });

  it('createWritable que lanza NotAllowedError → permission-denied', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { createError: namedError('NotAllowedError') });
    const { platform, file } = await openWithHandle(disk.handle);

    expect(codeOf(await platform.save(file, bytesData([2])))).toBe('permission-denied');
  });

  it('permiso denegado (requestPermission → denied) → permission-denied sin crear el writable', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { query: 'prompt', request: 'denied' });
    const { platform, file } = await openWithHandle(disk.handle);

    expect(codeOf(await platform.save(file, bytesData([2])))).toBe('permission-denied');
    expect(disk.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(disk.createWritable).not.toHaveBeenCalled();
  });

  it('con permiso en "prompt" que el usuario concede, guarda', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { query: 'prompt', request: 'granted' });
    const { platform, file } = await openWithHandle(disk.handle);

    expect((await platform.save(file, bytesData([2]))).ok).toBe(true);
    expect(disk.requestPermission).toHaveBeenCalledTimes(1);
  });

  it('con permiso ya concedido no pide permiso otra vez', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { query: 'granted' });
    const { platform, file } = await openWithHandle(disk.handle);

    await platform.save(file, bytesData([2]));
    expect(disk.requestPermission).not.toHaveBeenCalled();
  });

  it('sin API de permisos en el handle intenta escribir directamente', async () => {
    const disk = fakeDiskHandle(makeFile([1]), { noPermissionApi: true });
    const { platform, file } = await openWithHandle(disk.handle);

    expect((await platform.save(file, bytesData([2]))).ok).toBe(true);
  });

  it('en append, el File base se pasa a write() como Blob (mismo objeto, sin leerlo en memoria)', async () => {
    const base = makeFile([1, 2, 3]);
    const disk = fakeDiskHandle(base);
    const { platform, file } = await openWithHandle(disk.handle);

    await platform.save(file, { kind: 'append', base: file, expectedSize: 3, delta: new Uint8Array([4]) });

    const first = disk.records[0]?.parts[0];
    expect(first).toBe(base);
    expect(disk.records[0]?.parts[1]).toBeInstanceOf(Uint8Array);
  });

  it('save de un token que ya no está registrado → not-found', async () => {
    const disk = fakeDiskHandle(makeFile([1]));
    const { platform, file } = await openWithHandle(disk.handle);
    await platform.closeFile(file);

    expect(codeOf(await platform.save(file, bytesData([2])))).toBe('not-found');
    expect(disk.createWritable).not.toHaveBeenCalled();
  });

  it('append cuyo base ya no está registrado → not-found', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2]));
    const { platform, file } = await openWithHandle(disk.handle);
    const unregistered: OpenedFile = { ...file, token: 'no-registrado' };

    const result = await platform.save(file, {
      kind: 'append',
      base: unregistered,
      expectedSize: 1,
      delta: new Uint8Array([3]),
    });

    expect(codeOf(result)).toBe('not-found');
    expect(disk.createWritable).not.toHaveBeenCalled();
  });

  it('save de un fichero abierto con openBrowserFile → save-in-place-unsupported', async () => {
    const platform = createWebPlatform({ prefsPrefix: 'save.' }, fakeEnv());
    const opened = platform.openBrowserFile(makeFile([1]));
    if (!opened.ok) throw new Error('se esperaba ok');

    expect(codeOf(await platform.save(opened.value, bytesData([2])))).toBe('save-in-place-unsupported');
  });

  it('error de getFile al comprobar un append → io', async () => {
    const disk = fakeDiskHandle(makeFile([1, 2]));
    const { platform, file } = await openWithHandle(disk.handle);
    const getFile = vi.spyOn(disk.handle, 'getFile').mockRejectedValueOnce(new TypeError('roto'));

    const result = await platform.save(file, {
      kind: 'append',
      base: file,
      expectedSize: 2,
      delta: new Uint8Array([3]),
    });

    expect(getFile).toHaveBeenCalled();
    expect(codeOf(result)).toBe('io');
    expect(disk.createWritable).not.toHaveBeenCalled();
  });
});

describe('saveAs', () => {
  it('con selector: escribe en el fichero elegido y devuelve saved con token nuevo', async () => {
    const chosen = fakeDiskHandle(makeFile([]));
    const picker = vi.fn(async () => chosen.handle);
    const { platform, file } = await openWithHandle(fakeDiskHandle(makeFile([1, 2])).handle, { showSaveFilePicker: picker });

    const result = await platform.saveAs('copia.pdf', PDF_FILTERS, bytesData([7, 8, 9]));

    expect(picker).toHaveBeenCalledWith({
      suggestedName: 'copia.pdf',
      types: [{ description: 'PDF', accept: { 'application/pdf': ['.pdf'] } }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'saved') throw new Error('se esperaba saved');
    expect(result.value.file.token).not.toBe(file.token);
    expect(result.value.file.canSaveInPlace).toBe(true);
    expect(result.value.file.size).toBe(3);
    expect(await readOpened(result.value.file)).toEqual([7, 8, 9]);
    expect(chosen.records[0]?.closed).toBe(true);
  });

  it('con selector y append: la base se lee del registro y el resultado es base + incremento', async () => {
    const base = makeFile([1, 2]);
    const chosen = fakeDiskHandle(makeFile([]));
    const { platform, file } = await openWithHandle(fakeDiskHandle(base).handle, {
      showSaveFilePicker: async () => chosen.handle,
    });

    const result = await platform.saveAs('copia.pdf', PDF_FILTERS, {
      kind: 'append',
      base: file,
      expectedSize: 2,
      delta: new Uint8Array([3]),
    });

    expect(result.ok).toBe(true);
    if (!result.ok || result.value.kind !== 'saved') throw new Error('se esperaba saved');
    expect(await readOpened(result.value.file)).toEqual([1, 2, 3]);
  });

  it('selector cancelado (AbortError) → cancelled y no escribe', async () => {
    const { platform } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle, {
      showSaveFilePicker: vi.fn(async () => { throw namedError('AbortError'); }),
    });

    expect(await platform.saveAs('a.pdf', PDF_FILTERS, bytesData([2]))).toEqual({
      ok: true,
      value: { kind: 'cancelled' },
    });
  });

  it('error del selector distinto de cancelar se traduce como en abrir', async () => {
    const { platform } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle, {
      showSaveFilePicker: vi.fn(async () => { throw namedError('NotAllowedError'); }),
    });

    expect(codeOf(await platform.saveAs('a.pdf', PDF_FILTERS, bytesData([2])))).toBe('permission-denied');
  });

  it('permiso denegado en el fichero elegido → permission-denied', async () => {
    const chosen = fakeDiskHandle(makeFile([]), { query: 'denied', request: 'denied' });
    const { platform } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle, {
      showSaveFilePicker: async () => chosen.handle,
    });

    expect(codeOf(await platform.saveAs('a.pdf', PDF_FILTERS, bytesData([2])))).toBe('permission-denied');
    expect(chosen.createWritable).not.toHaveBeenCalled();
  });

  it('sin selector: descarga un Blob con los bytes y devuelve downloaded', async () => {
    const download = vi.fn<WebEnv['download']>();
    const { platform } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle, { download });

    const result = await platform.saveAs('nuevo.pdf', PDF_FILTERS, bytesData([4, 5]));

    expect(result).toEqual({ ok: true, value: { kind: 'downloaded', name: 'nuevo.pdf' } });
    expect(download).toHaveBeenCalledTimes(1);
    const [blob, name] = download.mock.calls[0] ?? [];
    expect(name).toBe('nuevo.pdf');
    if (blob === undefined) throw new Error('se esperaba un Blob');
    expect(Array.from(await readParts([blob]))).toEqual([4, 5]);
  });

  it('sin selector y append: el Blob es base + incremento y se comprueba changed-on-disk antes', async () => {
    const download = vi.fn<WebEnv['download']>();
    const { platform, file } = await openWithHandle(fakeDiskHandle(makeFile([1, 2, 3])).handle, { download });

    const bad = await platform.saveAs('a.pdf', PDF_FILTERS, {
      kind: 'append', base: file, expectedSize: 9, delta: new Uint8Array([4]),
    });
    expect(codeOf(bad)).toBe('changed-on-disk');
    expect(download).not.toHaveBeenCalled();

    const ok = await platform.saveAs('a.pdf', PDF_FILTERS, {
      kind: 'append', base: file, expectedSize: 3, delta: new Uint8Array([4, 5]),
    });
    expect(ok).toEqual({ ok: true, value: { kind: 'downloaded', name: 'a.pdf' } });
    const [blob] = download.mock.calls[0] ?? [];
    if (blob === undefined) throw new Error('se esperaba un Blob');
    expect(Array.from(await readParts([blob]))).toEqual([1, 2, 3, 4, 5]);
  });

  it('sin selector y base no registrada → not-found', async () => {
    const download = vi.fn<WebEnv['download']>();
    const { platform } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle, { download });
    const { file } = await openWithHandle(fakeDiskHandle(makeFile([1])).handle);
    const orphan: OpenedFile = { ...file, token: 'no-registrado' };

    const result = await platform.saveAs('a.pdf', PDF_FILTERS, {
      kind: 'append', base: orphan, expectedSize: 1, delta: new Uint8Array([2]),
    });

    expect(codeOf(result)).toBe('not-found');
    expect(download).not.toHaveBeenCalled();
  });
});
