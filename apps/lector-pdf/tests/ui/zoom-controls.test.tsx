// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Vista lista para usar los controles: documento «abierto» (sin páginas reales) y zoom 100 %. */
function openView(overrides: Partial<typeof initialViewerState> = {}): void {
  useViewer.setState({ ...initialViewerState, status: 'ready', zoom: 1, ...overrides });
}

function zoomInput(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Zoom' }) as HTMLInputElement;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
});

describe('Controles de zoom', () => {
  it('escribir 150 y pulsar Intro aplica el zoom personalizado 150 %', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);
    const input = zoomInput();
    expect(input).toHaveValue('100 %');

    await user.clear(input);
    await user.type(input, '150{Enter}');

    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.5 });
  });

  it('escribir algo que no es un número y pulsar Intro vuelve a mostrar el zoom anterior y avisa', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);
    const input = zoomInput();

    await user.clear(input);
    await user.type(input, 'abc{Enter}');

    expect(input).toHaveValue('100 %');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un porcentaje entre 10 y 6400');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'auto' });
  });

  it('Esc revierte lo escrito sin cambiar el zoom', async () => {
    const user = userEvent.setup();
    openView({ zoomMode: { kind: 'custom', zoom: 1.25 }, zoom: 1.25 });
    render(<App />);
    const input = zoomInput();

    await user.clear(input);
    await user.type(input, '333');
    expect(input).toHaveValue('333');
    await user.keyboard('{Escape}');

    expect(input).toHaveValue('125 %');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.25 });
  });

  it('elegir «Ajustar a la página» en la lista fija ese modo', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);

    await user.selectOptions(screen.getByRole('combobox', { name: 'Ajuste de zoom' }), 'Ajustar a la página');

    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-page' });
  });

  it('la lista refleja el modo: un porcentaje fijo muestra su opción y «Tamaño real» es 100 %', () => {
    openView({ zoomMode: { kind: 'custom', zoom: 1.5 }, zoom: 1.5 });
    render(<App />);
    expect(screen.getByRole('combobox', { name: 'Ajuste de zoom' })).toHaveValue('150');
  });

  it('un zoom personalizado sin opción deja la lista en blanco', () => {
    openView({ zoomMode: { kind: 'custom', zoom: 1.37 }, zoom: 1.37 });
    render(<App />);
    expect(screen.getByRole('combobox', { name: 'Ajuste de zoom' })).toHaveValue('');
  });

  it('los botones de icono tienen nombre accesible y su atajo en el título', () => {
    openView();
    render(<App />);
    const toolbar = screen.getByRole('toolbar', { name: 'Barra de herramientas' });
    expect(within(toolbar).getByRole('button', { name: 'Ampliar' })).toHaveAttribute('title', 'Ampliar (Ctrl++)');
    expect(within(toolbar).getByRole('button', { name: 'Reducir' })).toHaveAttribute('title', 'Reducir (Ctrl+-)');
    expect(within(toolbar).getByRole('button', { name: 'Girar a la izquierda' })).toHaveAttribute(
      'title',
      'Girar a la izquierda (Ctrl+Mayús+Flecha izquierda)',
    );
  });

  it('los controles de zoom y giro están deshabilitados sin documento', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Ampliar' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Girar a la derecha' })).toBeDisabled();
    expect(zoomInput()).toBeDisabled();
  });

  it('el campo, la lista y los botones son alcanzables con Tab y el orden es el de la barra', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);
    // Tab hasta «Reducir»: antes puede haber otros controles de la barra (Abrir, campo de página, herramientas).
    // El límite es holgado (la barra crece con las funciones); si no llega, la aserción de abajo falla con claridad.
    const reducir = screen.getByRole('button', { name: 'Reducir' });
    const maxTabs = document.querySelectorAll('button, input, select, textarea, a[href]').length;
    for (let i = 0; i < maxTabs && !reducir.matches(':focus'); i++) {
      await user.tab();
    }
    expect(screen.getByRole('button', { name: 'Reducir' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Ampliar' })).toHaveFocus();
    await user.tab();
    expect(zoomInput()).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('combobox', { name: 'Ajuste de zoom' })).toHaveFocus();
  });
});

describe('Atajos de vista', () => {
  it('Ctrl++, Ctrl+=, Ctrl+- y Ctrl+0/1/2 cambian el modo de zoom como corresponde', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);

    await user.keyboard('{Control>}+{/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.1 });

    act(() => useViewer.setState({ zoom: 1.1 }));
    await user.keyboard('{Control>}={/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.25 });

    act(() => useViewer.setState({ zoom: 1.25 }));
    await user.keyboard('{Control>}-{/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1.1 });

    await user.keyboard('{Control>}0{/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-page' });

    await user.keyboard('{Control>}1{/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'custom', zoom: 1 });

    await user.keyboard('{Control>}2{/Control}');
    expect(useViewer.getState().zoomMode).toEqual({ kind: 'fit-width' });
  });

  it('Ctrl+Mayús+Flecha derecha y Ctrl+Mayús+Flecha izquierda giran la vista', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);

    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}');
    expect(useViewer.getState().rotation).toBe(90);

    await user.keyboard('{Control>}{Shift>}{ArrowLeft}{ArrowLeft}{/Shift}{/Control}');
    expect(useViewer.getState().rotation).toBe(270);
  });

  it('dentro de un campo de texto, Ctrl+Mayús+Flecha derecha no gira la vista', async () => {
    const user = userEvent.setup();
    openView();
    render(<App />);

    zoomInput().focus();
    await user.keyboard('{Control>}{Shift>}{ArrowRight}{/Shift}{/Control}');

    expect(useViewer.getState().rotation).toBe(0);
  });

  it('sin documento abierto los atajos de vista no hacen nada', async () => {
    const user = userEvent.setup();
    useViewer.setState({ ...initialViewerState, status: 'empty' });
    render(<App />);

    await user.keyboard('{Control>}+{/Control}');

    expect(useViewer.getState().zoomMode).toEqual({ kind: 'auto' });
  });
});
