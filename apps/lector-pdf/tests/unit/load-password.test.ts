import { describe, expect, it } from 'vitest';
import { loadPdf } from '../../src/engine/load';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const AES256 = 'encrypted-aes-256.pdf';
const USER = 'usuario';
const OPEN_TIMEOUT = 30_000;

describe('loadPdf con requestPassword (PDF-148, ADR-0043)', () => {
  it('con la contraseña de usuario abre, la pide una vez (sin contraseña previa) y la devuelve en `password`', async () => {
    const asked: boolean[] = [];
    const requestPassword = (incorrect: boolean): Promise<string | null> => {
      asked.push(incorrect);
      return Promise.resolve(USER);
    };

    const result = await loadPdf(fixtureSource(AES256), { assetBaseUrl, requestPassword });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.numPages).toBe(5);
    expect(result.value.password).toBe(USER);
    expect(asked).toEqual([false]);
    await result.value.destroy();
  }, OPEN_TIMEOUT);

  it('con una contraseña incorrecta la vuelve a pedir marcándola como incorrecta y luego abre', async () => {
    const answers = ['mala', USER];
    const asked: boolean[] = [];
    const requestPassword = (incorrect: boolean): Promise<string | null> => {
      asked.push(incorrect);
      return Promise.resolve(answers.shift() ?? null);
    };

    const result = await loadPdf(fixtureSource(AES256), { assetBaseUrl, requestPassword });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(asked).toEqual([false, true]);
    expect(result.value.password).toBe(USER);
    await result.value.destroy();
  }, OPEN_TIMEOUT);

  it('si el usuario cancela (null) devuelve `cancelled`, no `password-required`', async () => {
    const asked: boolean[] = [];
    const requestPassword = (incorrect: boolean): Promise<string | null> => {
      asked.push(incorrect);
      return Promise.resolve(null);
    };

    const result = await loadPdf(fixtureSource(AES256), { assetBaseUrl, requestPassword });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('cancelled');
    expect(asked).toEqual([false]);
  }, OPEN_TIMEOUT);

  it('sin requestPassword, un cifrado sin contraseña devuelve `password-required` como hasta ahora', async () => {
    const result = await loadPdf(fixtureSource(AES256), { assetBaseUrl });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('password-required');
  }, OPEN_TIMEOUT);

  it('abortar la señal mientras requestPassword está pendiente devuelve `cancelled`', async () => {
    const controller = new AbortController();
    const requestPassword = (): Promise<string | null> => {
      controller.abort();
      return new Promise<string | null>(() => undefined);
    };

    const result = await loadPdf(fixtureSource(AES256), { assetBaseUrl, requestPassword, signal: controller.signal });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('cancelled');
  }, OPEN_TIMEOUT);
});
