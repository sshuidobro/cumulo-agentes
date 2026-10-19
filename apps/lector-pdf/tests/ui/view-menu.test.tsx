// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ViewMenu } from '../../src/ui/toolbar/ViewMenu';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState({ ...initialViewerState, status: 'ready', viewMode: { scroll: 'continuous', spread: 'none' } });
});

describe('menú «Vista»', () => {
  it('muestra las dos familias de opciones y marca la activa', async () => {
    const user = userEvent.setup();
    render(<ViewMenu />);
    await user.click(screen.getByRole('button', { name: 'Vista' }));
    expect(screen.getByRole('menuitemradio', { name: 'Desplazamiento continuo' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Una página a la vez' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: 'Página simple' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Doble página' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('menuitemradio', { name: 'Doble página con portada' })).toHaveAttribute('aria-checked', 'false');
  });

  it('elegir «Doble página con portada» y luego «Una página a la vez» cambia el modo sin tocar la otra familia', async () => {
    const user = userEvent.setup();
    render(<ViewMenu />);
    await user.click(screen.getByRole('button', { name: 'Vista' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Doble página con portada' }));
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'continuous', spread: 'cover' });

    await user.click(screen.getByRole('button', { name: 'Vista' }));
    await user.click(screen.getByRole('menuitemradio', { name: 'Una página a la vez' }));
    expect(useViewer.getState().viewMode).toEqual({ scroll: 'paged', spread: 'cover' });
  });

  it('se navega con flechas: ↓ lleva el foco a la opción siguiente', async () => {
    const user = userEvent.setup();
    render(<ViewMenu />);
    await user.click(screen.getByRole('button', { name: 'Vista' }));
    expect(screen.getByRole('menuitemradio', { name: 'Desplazamiento continuo' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitemradio', { name: 'Una página a la vez' })).toHaveFocus();
    act(() => {
      useViewer.setState({ viewMode: { scroll: 'paged', spread: 'none' } });
    });
    expect(screen.getByRole('menuitemradio', { name: 'Una página a la vez' })).toHaveAttribute('aria-checked', 'true');
  });
});
