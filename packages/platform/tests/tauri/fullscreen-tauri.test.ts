import { afterEach, describe, expect, it } from 'vitest';
import { configureLogging } from '@suite/shared';
import { createTauriPlatform } from '../../src/tauri/platform-tauri';
import type { TauriApi } from '../../src/tauri/tauri-api';

interface FakeWindow {
  readonly api: TauriApi;
  /** Valores pasados a `setFullscreen`. */
  readonly setCalls: boolean[];
  /** Estado que devuelve `isFullscreen` (lo cambia el test, como haría el SO). */
  fullscreen: boolean;
  /** Número de llamadas a `isFullscreen`. */
  isFullscreenCalls: number;
  /** Dispara el evento de cambio de tamaño registrado con `onResized`. */
  resize(): void;
  /** Número de manejadores de `onResized` que siguen activos. */
  readonly resizeListeners: number;
  /** Si está a true, `setFullscreen` rechaza. */
  failSet: boolean;
}

/** Doble falso de la ventana de Tauri: solo la parte de pantalla completa y de tamaño. */
function fakeWindow(initial = false): FakeWindow {
  const resizeHandlers = new Set<() => void>();
  const setCalls: boolean[] = [];
  const state = { fullscreen: initial, isFullscreenCalls: 0, failSet: false };

  const api: TauriApi = {
    invoke: () => Promise.reject(new Error('no usado en estos tests')),
    listen: () => Promise.resolve(() => undefined),
    setTitle: () => Promise.resolve(),
    onCloseRequested: () => Promise.resolve(() => undefined),
    destroyWindow: () => Promise.resolve(),
    openUrl: () => Promise.resolve(),
    setFullscreen(on: boolean): Promise<void> {
      setCalls.push(on);
      return state.failSet ? Promise.reject(new Error('sin permiso')) : Promise.resolve();
    },
    isFullscreen(): Promise<boolean> {
      state.isFullscreenCalls += 1;
      return Promise.resolve(state.fullscreen);
    },
    onResized(handler: () => void): Promise<() => void> {
      resizeHandlers.add(handler);
      return Promise.resolve(() => { resizeHandlers.delete(handler); });
    },
  };

  return {
    api,
    setCalls,
    get fullscreen() { return state.fullscreen; },
    set fullscreen(value: boolean) { state.fullscreen = value; },
    get isFullscreenCalls() { return state.isFullscreenCalls; },
    resize() {
      for (const handler of [...resizeHandlers]) handler();
    },
    get resizeListeners() { return resizeHandlers.size; },
    get failSet() { return state.failSet; },
    set failSet(value: boolean) { state.failSet = value; },
  };
}

/** Deja que terminen las promesas pendientes (refresco tras un cambio de tamaño). */
const flush = (): Promise<void> => new Promise<void>((resolve) => { setTimeout(resolve, 0); });

afterEach(() => {
  configureLogging({ sink: null });
});

describe('createTauriPlatform · pantalla completa', () => {
  it('setFullscreen(true) llama a window.setFullscreen(true) y devuelve ok', async () => {
    const win = fakeWindow();
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);

    const result = await platform.setFullscreen(true);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(win.setCalls).toEqual([true]);
  });

  it('si window.setFullscreen rechaza, devuelve err io con la causa', async () => {
    const win = fakeWindow();
    win.failSet = true;
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);

    const result = await platform.setFullscreen(true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
    expect(result.error.cause).toBeInstanceOf(Error);
  });

  it('un onResized que pasa de false a true avisa una vez con true', async () => {
    const win = fakeWindow(false);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);
    const cb = { calls: [] as boolean[] };
    platform.onFullscreenChange((on) => { cb.calls.push(on); });
    await flush();

    win.fullscreen = true;
    win.resize();
    await flush();

    expect(cb.calls).toEqual([true]);
    expect(platform.isFullscreen()).toBe(true);
  });

  it('dos onResized sin cambio de estado no avisan', async () => {
    const win = fakeWindow(false);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);
    const cb = { calls: [] as boolean[] };
    platform.onFullscreenChange((on) => { cb.calls.push(on); });
    await flush();

    win.resize();
    win.resize();
    await flush();

    expect(cb.calls).toEqual([]);
    expect(platform.isFullscreen()).toBe(false);
  });

  it('al empezar a escuchar sincroniza con la ventana, que ya estaba a pantalla completa', async () => {
    const win = fakeWindow(true);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);
    const cb = { calls: [] as boolean[] };
    platform.onFullscreenChange((on) => { cb.calls.push(on); });
    await flush();

    expect(platform.isFullscreen()).toBe(true);
    expect(cb.calls).toEqual([true]);
  });

  it('tras la baja no se avisa, pero el estado sigue actualizándose', async () => {
    const win = fakeWindow(false);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);
    const cb = { calls: [] as boolean[] };
    const unsubscribe = platform.onFullscreenChange((on) => { cb.calls.push(on); });
    await flush();
    unsubscribe();

    win.fullscreen = true;
    win.resize();
    await flush();

    expect(cb.calls).toEqual([]);
    expect(platform.isFullscreen()).toBe(true);
  });

  it('el cambio de tamaño consulta isFullscreen y solo hay un listener de tamaño', async () => {
    const win = fakeWindow(false);
    const platform = createTauriPlatform({ prefsPrefix: 'test:' }, win.api);
    platform.onFullscreenChange(() => undefined);
    platform.onFullscreenChange(() => undefined);
    await flush();
    const before = win.isFullscreenCalls;

    win.resize();
    await flush();

    expect(win.isFullscreenCalls).toBe(before + 1);
    expect(win.resizeListeners).toBe(1);
  });
});
