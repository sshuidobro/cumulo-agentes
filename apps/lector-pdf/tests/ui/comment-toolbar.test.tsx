// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
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

/** Abre la barra «Comentar» con el conmutador de la barra principal y devuelve la segunda fila. */
async function openCommentBar(user: ReturnType<typeof userEvent.setup>) {
  render(<App />);
  await user.click(screen.getByRole('button', { name: 'Comentar' }));
  return screen.getByRole('toolbar', { name: 'Comentar' });
}

describe('barra «Comentar» · conmutador', () => {
  it('pulsar «Comentar» muestra la barra con aria-pressed; otra pulsación la oculta y deja la herramienta en ninguna', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggle = screen.getByRole('button', { name: 'Comentar' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('toolbar', { name: 'Comentar' })).toBeNull();

    await user.click(toggle);
    expect(screen.getByRole('toolbar', { name: 'Comentar' })).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: 'Resaltar' }));
    expect(useAnnotations.getState().tool).toBe('highlight');

    await user.click(toggle);
    expect(screen.queryByRole('toolbar', { name: 'Comentar' })).toBeNull();
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(useAnnotations.getState().tool).toBe('none');
  });

  it('«Comentar» está deshabilitado sin documento abierto', () => {
    useViewer.setState({ ...initialViewerState, status: 'empty' });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Comentar' })).toBeDisabled();
  });
});

describe('barra «Comentar» · herramientas, grosor y tamaño', () => {
  it('clic en «Dibujar» la activa solo a ella y muestra «Grosor»; otro clic la desactiva', async () => {
    const user = userEvent.setup();
    const toolbar = await openCommentBar(user);
    const dibujar = within(toolbar).getByRole('button', { name: 'Dibujar' });
    expect(screen.queryByRole('button', { name: 'Grosor' })).toBeNull();

    await user.click(dibujar);
    expect(dibujar).toHaveAttribute('aria-pressed', 'true');
    expect(within(toolbar).getByRole('button', { name: 'Resaltar' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'Grosor' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tamaño de letra' })).toBeNull();

    await user.click(dibujar);
    expect(useAnnotations.getState().tool).toBe('none');
    expect(screen.queryByRole('button', { name: 'Grosor' })).toBeNull();
  });

  it('«Tamaño de letra» solo existe con «Texto» activo', async () => {
    const user = userEvent.setup();
    await openCommentBar(user);
    expect(screen.queryByRole('button', { name: 'Tamaño de letra' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Texto' }));
    expect(screen.getByRole('button', { name: 'Tamaño de letra' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Grosor' })).toBeNull();
  });

  it('el menú «Grosor» cambia el grosor del trazo y «Tamaño de letra» el de la letra', async () => {
    const user = userEvent.setup();
    await openCommentBar(user);

    await user.click(screen.getByRole('button', { name: 'Dibujar' }));
    await user.click(screen.getByRole('button', { name: 'Grosor' }));
    await user.click(screen.getByRole('menuitemradio', { name: '4 pt' }));
    expect(useAnnotations.getState().inkWidth).toBe(4);

    await user.click(screen.getByRole('button', { name: 'Texto' }));
    await user.click(screen.getByRole('button', { name: 'Tamaño de letra' }));
    await user.click(screen.getByRole('menuitemradio', { name: '18 pt' }));
    expect(useAnnotations.getState().fontSize).toBe(18);
  });
});

describe('barra «Comentar» · color', () => {
  it('«Color» está deshabilitado sin herramienta y, con «Resaltar», elegir «Verde» fija su color', async () => {
    const user = userEvent.setup();
    await openCommentBar(user);
    const color = screen.getByRole('button', { name: 'Color' });
    expect(color).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Resaltar' }));
    expect(color).toBeEnabled();
    await user.click(color);
    await user.click(screen.getByRole('menuitemradio', { name: 'Verde' }));
    expect(useAnnotations.getState().colors.highlight).toEqual([0.4, 0.73, 0.42]);

    await user.click(color);
    expect(screen.getByRole('menuitemradio', { name: 'Verde' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: 'Amarillo' })).toHaveAttribute('aria-checked', 'false');
  });
});

describe('barra «Comentar» · teclado', () => {
  it('→, ←, Inicio y Fin mueven el foco; solo un control es alcanzable con Tab', async () => {
    const user = userEvent.setup();
    const toolbar = await openCommentBar(user);
    const resaltar = within(toolbar).getByRole('button', { name: 'Resaltar' });
    const subrayar = within(toolbar).getByRole('button', { name: 'Subrayar' });
    const dibujar = within(toolbar).getByRole('button', { name: 'Dibujar' });
    act(() => {
      resaltar.focus();
    });

    await user.keyboard('{ArrowRight}');
    expect(subrayar).toHaveFocus();
    await user.keyboard('{End}');
    expect(dibujar).toHaveFocus();
    await user.keyboard('{Home}');
    expect(resaltar).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(dibujar).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(resaltar).toHaveFocus();

    const reachable = toolbar.querySelectorAll('[tabindex="0"]');
    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toBe(resaltar);
  });

  it('si el control activo desaparece (se oculta «Grosor»), el foco itinerante pasa al último visible', async () => {
    const user = userEvent.setup();
    const toolbar = await openCommentBar(user);
    await user.click(screen.getByRole('button', { name: 'Dibujar' }));
    act(() => {
      screen.getByRole('button', { name: 'Grosor' }).focus();
    });

    act(() => {
      useAnnotations.setState({ tool: 'highlight' });
    });
    const color = within(toolbar).getByRole('button', { name: 'Color' });
    const reachable = toolbar.querySelectorAll('[tabindex="0"]');
    expect(reachable).toHaveLength(1);
    expect(reachable[0]).toBe(color);
  });
});
