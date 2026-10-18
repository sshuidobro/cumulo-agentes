// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askChoice, useChoice } from '../../src/state/choice';
import { ChoiceDialog } from '../../src/ui/kit/ChoiceDialog';

beforeEach(() => {
  useChoice.setState({ active: null });
});

afterEach(() => {
  useChoice.setState({ active: null });
});

describe('askChoice y ChoiceDialog', () => {
  it('muestra el título, el mensaje y los botones; el botón pulsado resuelve con su valor', async () => {
    const user = userEvent.setup();
    render(<ChoiceDialog />);
    const pending = askChoice({
      title: '¿Guardar los cambios en «a.pdf»?',
      message: 'Detalle del aviso',
      options: [
        { label: 'Guardar', value: 'save' },
        { label: 'No guardar', value: 'discard' },
        { label: 'Cancelar', value: 'cancel' },
      ],
      cancel: 'cancel',
    });

    const dialog = await screen.findByRole('dialog', { name: '¿Guardar los cambios en «a.pdf»?' });
    expect(within(dialog).getByText('Detalle del aviso')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'No guardar' }));

    expect(await pending).toBe('discard');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });

  it('Esc resuelve con el valor de cancelación', async () => {
    const user = userEvent.setup();
    render(<ChoiceDialog />);
    const pending = askChoice({
      title: 'Pregunta',
      options: [
        { label: 'Aceptar', value: 'ok' },
        { label: 'Cancelar', value: 'cancel' },
      ],
      cancel: 'cancel',
    });
    await screen.findByRole('dialog', { name: 'Pregunta' });

    await user.keyboard('{Escape}');

    expect(await pending).toBe('cancel');
  });

  it('una elección nueva cierra la anterior con su valor de cancelación', async () => {
    render(<ChoiceDialog />);
    const first = askChoice({ title: 'Primera', options: [{ label: 'Sí', value: 'yes' }], cancel: 'no' });
    const second = askChoice({ title: 'Segunda', options: [{ label: 'Sí', value: 'yes' }], cancel: 'no' });

    expect(await first).toBe('no');
    await screen.findByRole('dialog', { name: 'Segunda' });
    expect(useChoice.getState().active?.title).toBe('Segunda');
    useChoice.getState().active?.options[0]?.pick();
    expect(await second).toBe('yes');
  });

  it('sin elección activa no pinta ningún diálogo', () => {
    render(<ChoiceDialog />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
