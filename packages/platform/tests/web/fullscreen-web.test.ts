// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import { fakeEnv, namedError } from './fakes';

/** Define una propiedad de prueba en un objeto del DOM (jsdom no implementa la pantalla completa). */
function defineOn(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
}

/** Simula el estado de `document.fullscreenElement`. */
let fullscreenElement: Element | null = null;

function platform() {
  return createWebPlatform({ prefsPrefix: 'test.' }, fakeEnv());
}

afterEach(() => {
  Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
  Reflect.deleteProperty(document, 'exitFullscreen');
  Reflect.deleteProperty(document, 'fullscreenElement');
  fullscreenElement = null;
  vi.restoreAllMocks();
});

describe('pantalla completa en la plataforma web · setFullscreen', () => {
  it('setFullscreen(true) llama a requestFullscreen con la barra oculta y devuelve ok', async () => {
    const requestFullscreen = vi.fn(async () => undefined);
    defineOn(document.documentElement, 'requestFullscreen', requestFullscreen);

    const result = await platform().setFullscreen(true);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(requestFullscreen).toHaveBeenCalledTimes(1);
    expect(requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' });
  });

  it('si requestFullscreen rechaza, devuelve err unsupported con la causa', async () => {
    const cause = namedError('TypeError');
    defineOn(document.documentElement, 'requestFullscreen', vi.fn(() => Promise.reject(cause)));

    const result = await platform().setFullscreen(true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unsupported');
    expect(result.error.cause).toBe(cause);
  });

  it('sin requestFullscreen devuelve err unsupported sin lanzar', async () => {
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');

    const result = await platform().setFullscreen(true);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unsupported');
  });

  it('setFullscreen(false) llama a document.exitFullscreen y devuelve ok', async () => {
    const exitFullscreen = vi.fn(async () => undefined);
    defineOn(document, 'exitFullscreen', exitFullscreen);

    const result = await platform().setFullscreen(false);

    expect(result).toEqual({ ok: true, value: undefined });
    expect(exitFullscreen).toHaveBeenCalledTimes(1);
  });

  it('sin exitFullscreen, setFullscreen(false) devuelve err unsupported sin lanzar', async () => {
    Reflect.deleteProperty(document, 'exitFullscreen');

    const result = await platform().setFullscreen(false);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('unsupported');
  });
});

describe('pantalla completa en la plataforma web · estado y avisos', () => {
  // `fullscreenElement` se lee en cada consulta: el test lo cambia con la variable de módulo.
  const withFullscreenElement = (): void => {
    Object.defineProperty(document, 'fullscreenElement', { get: () => fullscreenElement, configurable: true });
  };

  it('isFullscreen es true solo si document.fullscreenElement existe', () => {
    withFullscreenElement();
    const fs = platform();

    expect(fs.isFullscreen()).toBe(false);

    fullscreenElement = document.documentElement;
    expect(fs.isFullscreen()).toBe(true);
  });

  it('un evento fullscreenchange con fullscreenElement avisa con true; tras la baja no avisa', () => {
    withFullscreenElement();
    const fs = platform();
    const cb = vi.fn();
    const unsubscribe = fs.onFullscreenChange(cb);

    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(true);

    unsubscribe();
    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));

    expect(cb).toHaveBeenCalledTimes(1);
  });
});
