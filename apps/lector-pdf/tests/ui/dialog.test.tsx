// @vitest-environment jsdom
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dialog } from '../../src/ui/kit/Dialog';

/** Botón que abre el diálogo, como el enlace que lo abre en la app. */
function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => { setOpen(true); }}>
        Disparador
      </button>
      <Dialog
        open={open}
        title="Abrir enlace externo"
        actions={[
          { label: 'Abrir', onClick: () => { setOpen(false); } },
          { label: 'Cancelar', onClick: () => { setOpen(false); } },
        ]}
        onClose={() => { setOpen(false); }}
      >
        Se abrirá la dirección.
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('no pinta nada cuando está cerrado', () => {
    render(<Dialog open={false} title="T" actions={[]} onClose={() => undefined}>x</Dialog>);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('es un diálogo modal con nombre accesible y enfoca el primer botón al abrir', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Disparador' }));

    const dialog = screen.getByRole('dialog', { name: 'Abrir enlace externo' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('button', { name: 'Abrir' })).toHaveFocus();
  });

  it('Esc cierra y devuelve el foco al botón que lo abrió', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Disparador' });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('Tab no sale del diálogo: da la vuelta de último a primero y de primero a último', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Disparador' }));
    const open = screen.getByRole('button', { name: 'Abrir' });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });

    expect(open).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(open).toHaveFocus();
    await user.tab({ shift: true });
    expect(cancel).toHaveFocus();
  });

  it('Esc llama a onClose y no se propaga a la ventana', () => {
    let closed = 0;
    let windowSawEscape = false;
    const listener = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') windowSawEscape = true;
    };
    window.addEventListener('keydown', listener);
    try {
      render(
        <Dialog open title="T" actions={[{ label: 'Ok', onClick: () => undefined }]} onClose={() => { closed += 1; }}>
          x
        </Dialog>,
      );
      fireEvent.keyDown(screen.getByRole('button', { name: 'Ok' }), { key: 'Escape' });
      expect(closed).toBe(1);
      expect(windowSawEscape).toBe(false);
    } finally {
      window.removeEventListener('keydown', listener);
    }
  });
});
