// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askPassword, cancelPassword, usePasswordPrompt } from '../../src/state/password-prompt';
import { PasswordDialog } from '../../src/ui/security/PasswordDialog';

/** Lanza una petición dentro de `act` para que el diálogo ya montado se actualice. */
function ask(name: string, incorrect: boolean): Promise<string | null> {
  let pending: Promise<string | null> = Promise.resolve(null);
  act(() => {
    pending = askPassword(name, incorrect);
  });
  return pending;
}

beforeEach(() => {
  usePasswordPrompt.setState({ request: null });
});

afterEach(() => {
  cancelPassword();
  usePasswordPrompt.setState({ request: null });
});

describe('PasswordDialog', () => {
  it('sin petición no muestra nada', () => {
    render(<PasswordDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('muestra el nombre del fichero, un campo de contraseña enfocado y Abrir deshabilitado con el campo vacío', () => {
    render(<PasswordDialog />);
    void ask('secreto.pdf', false);

    expect(screen.getByRole('dialog', { name: 'Contraseña necesaria' })).toBeTruthy();
    expect(screen.getByText('“secreto.pdf” está protegido. Escribe la contraseña para abrirlo.')).toBeTruthy();
    const field = screen.getByLabelText('Contraseña');
    expect(field.getAttribute('type')).toBe('password');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('button', { name: 'Abrir' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('escribir y pulsar Abrir resuelve con la contraseña', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);
    const pending = ask('a.pdf', false);

    await user.type(screen.getByLabelText('Contraseña'), 'usuario');
    expect(screen.getByRole('button', { name: 'Abrir' }).hasAttribute('disabled')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Abrir' }));

    await expect(pending).resolves.toBe('usuario');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Intro envía la contraseña; con el campo vacío no hace nada', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);
    const pending = ask('a.pdf', false);

    await user.keyboard('{Enter}');
    expect(usePasswordPrompt.getState().request).not.toBeNull();

    await user.type(screen.getByLabelText('Contraseña'), 'propietario{Enter}');
    await expect(pending).resolves.toBe('propietario');
  });

  it('con contraseña incorrecta muestra el aviso con role alert y deja el campo vacío y enfocado', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);
    const first = ask('a.pdf', false);
    await user.type(screen.getByLabelText('Contraseña'), 'mal{Enter}');
    await expect(first).resolves.toBe('mal');

    void ask('a.pdf', true);

    expect(screen.getByRole('alert').textContent).toBe('La contraseña no es correcta.');
    const field = screen.getByLabelText<HTMLInputElement>('Contraseña');
    expect(field.value).toBe('');
    expect(document.activeElement).toBe(field);
  });

  it('Cancelar y Esc resuelven con null y cierran el diálogo sin mensaje de error', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);

    const byButton = ask('a.pdf', false);
    await user.click(screen.getByRole('button', { name: 'Cancelar' }));
    await expect(byButton).resolves.toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();

    const byEsc = ask('a.pdf', false);
    await user.keyboard('{Escape}');
    await expect(byEsc).resolves.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('la casilla «Mostrar contraseña» cambia el campo a texto visible', async () => {
    const user = userEvent.setup();
    render(<PasswordDialog />);
    void ask('a.pdf', false);

    await user.click(screen.getByRole('checkbox', { name: 'Mostrar contraseña' }));
    await user.type(screen.getByLabelText('Contraseña'), 'abc');

    expect(screen.getByLabelText<HTMLInputElement>('Contraseña').type).toBe('text');
    expect(screen.getByLabelText<HTMLInputElement>('Contraseña').value).toBe('abc');
  });
});
