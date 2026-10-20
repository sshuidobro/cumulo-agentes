// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { editMsg } from '../../src/ui/messages-edit';
import { endAnnotationSession } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState({ ...initialViewerState, status: 'ready' });
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
});

/** Abre la barra «Editar» con su botón de la barra principal y devuelve la segunda fila. */
async function openEditBar(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(screen.getByRole('button', { name: editMsg.editButton }));
  // La barra se carga con React.lazy: hay que esperar a que aparezca.
  return screen.findByRole('toolbar', { name: editMsg.editButton });
}

describe('barra «Editar» (PDF-130)', () => {
  it('«Editar» abre la barra con aria-pressed; «Cerrar» la oculta', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: editMsg.editButton });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    await user.click(toggle);
    expect(await screen.findByRole('toolbar', { name: editMsg.editButton })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: editMsg.close }));
    expect(screen.queryByRole('toolbar', { name: editMsg.editButton })).toBeNull();
    expect(useAnnotations.getState().editBarOpen).toBe(false);
  });

  it('«Añadir texto» activa la herramienta page-text; otra pulsación la desactiva', async () => {
    const user = userEvent.setup();
    await openEditBar(user);
    const addText = screen.getByRole('button', { name: editMsg.addText });

    await user.click(addText);
    expect(useAnnotations.getState().tool).toBe('page-text');
    expect(addText).toHaveAttribute('aria-pressed', 'true');

    await user.click(addText);
    expect(useAnnotations.getState().tool).toBe('none');
    expect(addText).toHaveAttribute('aria-pressed', 'false');
  });

  it('se maneja solo con teclado: Tab llega a los controles y Enter los activa', async () => {
    const user = userEvent.setup();
    render(<App />);
    screen.getByRole('button', { name: editMsg.editButton }).focus();
    await user.keyboard('{Enter}');
    const bar = await screen.findByRole('toolbar', { name: editMsg.editButton });

    const addText = screen.getByRole('button', { name: editMsg.addText });
    addText.focus();
    expect(addText).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(useAnnotations.getState().tool).toBe('page-text');

    await user.tab();
    expect(bar.contains(document.activeElement)).toBe(true);
  });

  it('«Comentar» cierra la barra «Editar»', async () => {
    const user = userEvent.setup();
    await openEditBar(user);
    await user.click(screen.getByRole('button', { name: 'Comentar' }));
    expect(await screen.findByRole('toolbar', { name: 'Comentar' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: editMsg.editButton })).toBeNull();
  });

  it('«Editar» está deshabilitado sin documento abierto', () => {
    useViewer.setState({ ...initialViewerState, status: 'empty' });
    render(<App />);
    expect(screen.getByRole('button', { name: editMsg.editButton })).toBeDisabled();
  });
});
