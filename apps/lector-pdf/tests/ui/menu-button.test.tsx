// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MenuButton } from '../../src/ui/kit/MenuButton';

type Choice = 'uno' | 'dos';

/** Menú de prueba: dos radios, un separador y una casilla. */
function Harness({ onCheck }: { readonly onCheck: (checked: boolean) => void }) {
  const [choice, setChoice] = useState<Choice>('uno');
  const [checked, setChecked] = useState(false);
  return (
    <MenuButton
      label="Menú"
      entries={[
        { kind: 'radio', label: 'Uno', checked: choice === 'uno', onSelect: () => { setChoice('uno'); } },
        { kind: 'radio', label: 'Dos', checked: choice === 'dos', onSelect: () => { setChoice('dos'); } },
        'separator',
        {
          kind: 'checkbox',
          label: 'Casilla',
          checked,
          onSelect: () => {
            setChecked(!checked);
            onCheck(!checked);
          },
        },
      ]}
    >
      <span>icono</span>
    </MenuButton>
  );
}

function renderMenu(onCheck = vi.fn()) {
  render(<Harness onCheck={onCheck} />);
  return { button: screen.getByRole('button', { name: 'Menú' }), onCheck };
}

describe('MenuButton', () => {
  it('Intro sobre el botón abre el menú con el foco en el primer elemento', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    button.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menu', { name: 'Menú' })).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.getAttribute('aria-haspopup')).toBe('menu');
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Uno' }));
  });

  it('el clic abre el menú', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    expect(screen.getByRole('menu')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Uno' }));
  });

  it('↓ y ↑ mueven el foco con vuelta; Inicio y Fin van a los extremos', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    const uno = screen.getByRole('menuitemradio', { name: 'Uno' });
    const dos = screen.getByRole('menuitemradio', { name: 'Dos' });
    const casilla = screen.getByRole('menuitemcheckbox', { name: 'Casilla' });

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(dos);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(casilla);
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(uno);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(casilla);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(uno);
    await user.keyboard('{End}');
    expect(document.activeElement).toBe(casilla);
  });

  it('Esc cierra el menú y devuelve el foco al botón', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('un clic fuera cierra el menú sin robar el foco', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    await user.click(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).not.toBe(button);
  });

  it('activar una radio la marca, cierra el menú y devuelve el foco al botón', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    await user.click(button);
    expect(screen.getByRole('menuitemradio', { name: 'Uno' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Dos' }).getAttribute('aria-checked')).toBe('false');

    await user.keyboard('{ArrowDown}{Enter}');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);

    await user.click(button);
    expect(screen.getByRole('menuitemradio', { name: 'Uno' }).getAttribute('aria-checked')).toBe('false');
    expect(screen.getByRole('menuitemradio', { name: 'Dos' }).getAttribute('aria-checked')).toBe('true');
  });

  it('la casilla alterna su estado con Espacio y lo comunica', async () => {
    const user = userEvent.setup();
    const { button, onCheck } = renderMenu();
    await user.click(button);
    const casilla = screen.getByRole('menuitemcheckbox', { name: 'Casilla' });
    expect(casilla.getAttribute('aria-checked')).toBe('false');

    await user.keyboard('{End}{ }');
    expect(onCheck).toHaveBeenCalledWith(true);

    await user.click(button);
    expect(screen.getByRole('menuitemcheckbox', { name: 'Casilla' }).getAttribute('aria-checked')).toBe('true');
  });

  it('↓ sobre el botón cerrado lo abre', async () => {
    const user = userEvent.setup();
    const { button } = renderMenu();
    button.focus();
    await act(async () => {
      await user.keyboard('{ArrowDown}');
    });
    expect(screen.getByRole('menu')).toBeTruthy();
  });
});
