import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform } from '@suite/platform';
import {
  cancelOpening,
  closeDocument,
  currentPassword,
  openDocument,
} from '../../src/state/document-actions';
import { cancelPassword, submitPassword, usePasswordPrompt } from '../../src/state/password-prompt';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

const assetBaseUrl = nodeAssetBase();
const USER = 'usuario';
const OWNER = 'propietario';
const AES128 = 'encrypted-aes-128.pdf';

let platform: Platform;

beforeEach(() => {
  platform = createFakePlatform();
  initServices({ platform, assetBaseUrl });
  useViewer.setState(initialViewerState);
  usePasswordPrompt.setState({ request: null });
});

afterEach(async () => {
  cancelPassword();
  await closeDocument();
  usePasswordPrompt.setState({ request: null });
});

/** Espera a que aparezca la petición de contraseña (sondeo breve, sin depender de la hora). */
async function waitForPrompt(): Promise<{ readonly name: string; readonly incorrect: boolean }> {
  for (let i = 0; i < 3000; i += 1) {
    const request = usePasswordPrompt.getState().request;
    if (request !== null) return request;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error('No apareció la petición de contraseña');
}

describe('openDocument con contraseña (PDF-046)', () => {
  it('pide la contraseña de un PDF cifrado; con la de usuario abre y la guarda en memoria', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await expect(waitForPrompt()).resolves.toMatchObject({ name: AES128, incorrect: false });
    submitPassword(USER);
    await opening;

    const state = useViewer.getState();
    expect(state.status).toBe('ready');
    expect(state.pdf?.numPages).toBe(5);
    expect(usePasswordPrompt.getState().request).toBeNull();
    expect(currentPassword()).toBe(USER);
  });

  it('con una contraseña incorrecta vuelve a pedirla marcando el error; la de propietario también abre', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await waitForPrompt();
    submitPassword('mal');
    await expect(waitForPrompt()).resolves.toMatchObject({ name: AES128, incorrect: true });
    submitPassword(OWNER);
    await opening;

    expect(useViewer.getState().status).toBe('ready');
    expect(currentPassword()).toBe(OWNER);
  });

  it('cancelar la petición deja el estado vacío, sin error, y cierra el fichero', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await waitForPrompt();
    cancelPassword();
    await opening;

    const state = useViewer.getState();
    expect(state.status).toBe('empty');
    expect(state.error).toBeNull();
    expect(state.pdf).toBeNull();
    expect(currentPassword()).toBeNull();
    expect(platform.closeFile).toHaveBeenCalled();
  });

  it('cancelOpening mientras se pide la contraseña deja el estado vacío sin mensaje', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await waitForPrompt();
    cancelOpening();
    await opening;

    expect(useViewer.getState().status).toBe('empty');
    expect(useViewer.getState().error).toBeNull();
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('cerrar el documento mientras se pide la contraseña no deja un diálogo colgado', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await waitForPrompt();
    await closeDocument();
    await opening;

    expect(usePasswordPrompt.getState().request).toBeNull();
    expect(useViewer.getState().status).toBe('empty');
  });

  it('un PDF solo con contraseña de propietario abre sin pedir nada', async () => {
    await openDocument(openedFile('encrypted-owner-only.pdf', fixtureSource('encrypted-owner-only.pdf')));

    expect(usePasswordPrompt.getState().request).toBeNull();
    expect(useViewer.getState().status).toBe('ready');
    expect(currentPassword()).toBeNull();
  });

  it('con opts.password correcta abre sin preguntar', async () => {
    await openDocument(openedFile(AES128, fixtureSource(AES128)), { password: USER });

    expect(usePasswordPrompt.getState().request).toBeNull();
    expect(useViewer.getState().status).toBe('ready');
    expect(currentPassword()).toBe(USER);
  });

  it('con opts.password incorrecta pregunta de nuevo con el error', async () => {
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)), { password: 'mal' });

    await expect(waitForPrompt()).resolves.toMatchObject({ name: AES128, incorrect: true });
    cancelPassword();
    await opening;
    expect(useViewer.getState().status).toBe('empty');
  });

  it('la contraseña nunca se escribe en la consola ni en las preferencias de la plataforma', async () => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method));
    const prefsSet = vi.spyOn(platform.prefs, 'set');
    const opening = openDocument(openedFile(AES128, fixtureSource(AES128)));

    await waitForPrompt();
    submitPassword(USER);
    await opening;

    const written = consoleSpies.flatMap((spy) => spy.mock.calls.flat()).map((part) => String(part));
    expect(written.some((text) => text.includes(USER))).toBe(false);
    expect(JSON.stringify(prefsSet.mock.calls)).not.toContain(USER);
    consoleSpies.forEach((spy) => { spy.mockRestore(); });
  });
});
