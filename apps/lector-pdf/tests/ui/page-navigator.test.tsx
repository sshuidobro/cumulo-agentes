// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { PageDimsTable } from '../../src/core/page-dims';
import { memorySource } from '@suite/platform';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

/** Etiquetas de un PDF de 12 páginas: i, ii, iii, iv, 1 … 7, A-1. */
const LABELS: readonly string[] = ['i', 'ii', 'iii', 'iv', '1', '2', '3', '4', '5', '6', '7', 'A-1'];

/** App con un documento «abierto» de `count` páginas (sin contenido real) en la página `current`. */
function openView(count: number, overrides: Partial<typeof initialViewerState> = {}): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(count, 612, 792, 0),
    dimsVersion: 1,
    zoom: 1,
    zoomMode: { kind: 'custom', zoom: 1 },
    ...overrides,
  });
}

function pageField(): HTMLInputElement {
  return screen.getByRole('textbox', { name: 'Número de página' }) as HTMLInputElement;
}

function requestedPage(): number | undefined {
  return useViewer.getState().navRequest?.page;
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
});

describe('Campo de página', () => {
  it('escribir 250 e Intro con 300 páginas va a la página 250 (índice 249)', async () => {
    const user = userEvent.setup();
    openView(300);
    render(<App />);
    const field = pageField();

    await user.clear(field);
    await user.type(field, '250{Enter}');

    expect(requestedPage()).toBe(249);
    expect(field).toHaveAttribute('aria-invalid', 'false');
  });

  it('escribir 400 e Intro marca el campo como inválido, avisa y mantiene lo escrito', async () => {
    const user = userEvent.setup();
    openView(300);
    render(<App />);
    const field = pageField();

    await user.clear(field);
    await user.type(field, '400{Enter}');

    expect(requestedPage()).toBeUndefined();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveValue('400');
    expect(screen.getByRole('alert')).toHaveTextContent('Escribe un número de página entre 1 y 300');
    expect(field).toHaveAccessibleDescription('Escribe un número de página entre 1 y 300');
  });

  it('Esc restaura el número de la página actual', async () => {
    const user = userEvent.setup();
    openView(300, { currentPage: 9 });
    render(<App />);
    const field = pageField();
    expect(field).toHaveValue('10');

    await user.clear(field);
    await user.type(field, '400');
    await user.keyboard('{Escape}');

    expect(field).toHaveValue('10');
    expect(field).toHaveAttribute('aria-invalid', 'false');
    expect(requestedPage()).toBeUndefined();
  });

  it('al salir del campo se muestra de nuevo la página actual', async () => {
    const user = userEvent.setup();
    openView(300, { currentPage: 0 });
    render(<App />);
    const field = pageField();

    await user.clear(field);
    await user.type(field, '77');
    await user.tab();

    expect(field).toHaveValue('1');
  });

  it('al recibir el foco selecciona todo el texto', async () => {
    const user = userEvent.setup();
    openView(300, { currentPage: 41 });
    render(<App />);
    const field = pageField();

    await user.click(field);

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe('42'.length);
  });

  it('con etiquetas muestra «i» y «(1 de 12)», y escribir A-1 e Intro va a la página 12', async () => {
    const user = userEvent.setup();
    openView(12, { pageLabels: LABELS });
    render(<App />);
    const field = pageField();

    expect(field).toHaveValue('i');
    expect(screen.getByText('(1 de 12)')).toBeVisible();

    await user.clear(field);
    await user.type(field, 'A-1{Enter}');

    expect(requestedPage()).toBe(11);
  });

  it('el botón «Página anterior» está deshabilitado en la página 1 y «Página siguiente» en la última', () => {
    openView(3, { currentPage: 0 });
    const { unmount } = render(<App />);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeEnabled();
    unmount();

    openView(3, { currentPage: 2 });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Página anterior' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Página siguiente' })).toBeDisabled();
  });

  it('los botones anterior y siguiente cambian de página', async () => {
    const user = userEvent.setup();
    openView(10, { currentPage: 4 });
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Página siguiente' }));
    expect(requestedPage()).toBe(5);
  });
});

describe('Atajos de navegación', () => {
  it('ArrowRight pasa a la página siguiente', () => {
    openView(10, { currentPage: 2 });
    render(<App />);

    fireEvent.keyDown(document.body, { key: 'ArrowRight' });

    expect(requestedPage()).toBe(3);
  });

  it('con desbordamiento horizontal, ArrowRight no cambia de página y deja el evento al navegador', () => {
    openView(10, { currentPage: 2, hasHorizontalOverflow: true });
    render(<App />);

    const notPrevented = fireEvent.keyDown(document.body, { key: 'ArrowRight' });

    expect(notPrevented).toBe(true);
    expect(useViewer.getState().navRequest).toBeNull();
  });

  it('dentro del campo de página, ArrowRight mueve el cursor del texto y no cambia de página', async () => {
    const user = userEvent.setup();
    openView(10, { currentPage: 2 });
    render(<App />);
    const field = pageField();

    await user.click(field);
    await user.keyboard('{ArrowRight}');

    expect(useViewer.getState().navRequest).toBeNull();
  });

  it('Mod+Shift+N enfoca el campo de página con el texto seleccionado', () => {
    openView(10, { currentPage: 6 });
    render(<App />);

    fireEvent.keyDown(document.body, { key: 'N', ctrlKey: true, shiftKey: true });

    expect(pageField()).toHaveFocus();
    expect(pageField().selectionStart).toBe(0);
    expect(pageField().selectionEnd).toBe(1);
  });

  it('Inicio y Fin van a la primera y a la última página; Mod+PageDown avanza aunque haya desbordamiento', async () => {
    openView(12, { currentPage: 5, hasHorizontalOverflow: true });
    render(<App />);

    fireEvent.keyDown(document.body, { key: 'End' });
    await waitFor(() => expect(requestedPage()).toBe(11));
    fireEvent.keyDown(document.body, { key: 'Home' });
    await waitFor(() => expect(requestedPage()).toBe(0));

    act(() => {
      useViewer.setState({ currentPage: 0 });
    });
    fireEvent.keyDown(document.body, { key: 'PageDown', ctrlKey: true });
    await waitFor(() => expect(requestedPage()).toBe(1));
  });
});
