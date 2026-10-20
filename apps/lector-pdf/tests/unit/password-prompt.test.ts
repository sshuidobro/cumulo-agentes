import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askPassword, cancelPassword, submitPassword, usePasswordPrompt } from '../../src/state/password-prompt';

beforeEach(() => {
  usePasswordPrompt.setState({ request: null });
});

afterEach(() => {
  cancelPassword();
  usePasswordPrompt.setState({ request: null });
});

describe('askPassword', () => {
  it('muestra la petición y resuelve con la contraseña enviada', async () => {
    const pending = askPassword('a.pdf', false);
    expect(usePasswordPrompt.getState().request).toMatchObject({ name: 'a.pdf', incorrect: false });

    submitPassword('usuario');

    await expect(pending).resolves.toBe('usuario');
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('resuelve con null al cancelar y limpia la petición', async () => {
    const pending = askPassword('a.pdf', false);

    cancelPassword();

    await expect(pending).resolves.toBeNull();
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('una petición nueva cancela la anterior (resuelve con null) y deja visible solo la nueva', async () => {
    const first = askPassword('a.pdf', false);
    const second = askPassword('a.pdf', true);

    await expect(first).resolves.toBeNull();
    expect(usePasswordPrompt.getState().request).toMatchObject({ incorrect: true });

    submitPassword('propietario');
    await expect(second).resolves.toBe('propietario');
  });

  it('cada petición tiene un identificador distinto para remontar el diálogo', () => {
    void askPassword('a.pdf', false);
    const firstId = usePasswordPrompt.getState().request?.id;
    void askPassword('a.pdf', true);
    const secondId = usePasswordPrompt.getState().request?.id;

    expect(firstId).toBeDefined();
    expect(secondId).not.toBe(firstId);
  });

  it('submitPassword y cancelPassword sin petición no hacen nada', () => {
    expect(() => {
      submitPassword('x');
      cancelPassword();
    }).not.toThrow();
    expect(usePasswordPrompt.getState().request).toBeNull();
  });

  it('una resolución no se repite: enviar dos veces resuelve una sola vez con el primer valor', async () => {
    const pending = askPassword('a.pdf', false);
    submitPassword('uno');
    submitPassword('dos');

    await expect(pending).resolves.toBe('uno');
  });
});
