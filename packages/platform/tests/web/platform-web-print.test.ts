import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPlatform } from '../../src/web/platform-web';
import type { WebEnv } from '../../src/web/web-env';
import { defaultWebEnv } from '../../src/web/web-env';
import { fakeEnv } from './fakes';

function platformWith(env: WebEnv) {
  return createWebPlatform({ prefsPrefix: 'test.' }, env);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('print en la plataforma web', () => {
  it('llama una vez a window.print y devuelve ok', async () => {
    const print = vi.fn();
    const result = await platformWith(fakeEnv({ print })).print();

    expect(result).toEqual({ ok: true, value: undefined });
    expect(print).toHaveBeenCalledTimes(1);
  });

  it('si window.print lanza, devuelve err de tipo io con la causa', async () => {
    const cause = new Error('bloqueado');
    const result = await platformWith(fakeEnv({ print: () => { throw cause; } })).print();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('io');
    expect(result.error.cause).toBe(cause);
  });

  it('defaultWebEnv().print llama a window.print del navegador', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    defaultWebEnv().print();
    expect(print).toHaveBeenCalledTimes(1);
  });
});
