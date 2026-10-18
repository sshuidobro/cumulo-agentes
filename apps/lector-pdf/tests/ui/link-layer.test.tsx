// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PageLink } from '../../src/engine/links';
import type { LoadedPdf } from '../../src/engine/load';
import { getPageLinks } from '../../src/engine/links';
import { navigateToDest, runNamedAction } from '../../src/state/history';
import { initServices } from '../../src/state/services';
import { useViewer, initialViewerState } from '../../src/state/viewer-store';
import { LinkLayer } from '../../src/ui/viewer/LinkLayer';
import { msg } from '../../src/ui/messages';
import { zoomToScale } from '../../src/core/zoom';
import { createFakePlatform } from '../helpers/fake-platform';
import { ok, err } from '@suite/shared';
import { platformError } from '@suite/platform';

vi.mock('../../src/engine/links', () => ({ getPageLinks: vi.fn() }));
vi.mock('../../src/state/history', () => ({
  navigateToDest: vi.fn(async () => undefined),
  runNamedAction: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
}));

const PAGE_HEIGHT = 792;
const EXTERNAL = 'https://example.org/ruta?x=1';

/** Viewport de prueba: convierte puntos PDF (origen abajo) a píxeles (origen arriba), a la escala pedida. */
function fakePage() {
  return {
    rotate: 0,
    getViewport: ({ scale }: { scale: number }) => ({
      convertToViewportPoint: (x: number, y: number) => [x * scale, (PAGE_HEIGHT - y) * scale],
    }),
  };
}

const LINKS: readonly PageLink[] = [
  { rect: [72, 700, 300, 720], target: { kind: 'internal', dest: 'destino-final' } },
  { rect: [72, 670, 300, 690], target: { kind: 'external', url: EXTERNAL } },
  { rect: [72, 640, 300, 660], target: { kind: 'blocked', reason: 'unsupported' } },
  { rect: [72, 610, 300, 630], target: { kind: 'action', action: 'next-page' } },
];

function setDocument(): void {
  const page = fakePage();
  const doc = { getPage: vi.fn(async () => page) };
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: { doc } as unknown as LoadedPdf });
}

beforeEach(() => {
  vi.mocked(getPageLinks).mockReset();
  vi.mocked(getPageLinks).mockResolvedValue([...LINKS]);
  vi.mocked(navigateToDest).mockClear();
  vi.mocked(runNamedAction).mockClear();
  useViewer.setState(initialViewerState);
  setDocument();
});

describe('LinkLayer', () => {
  it('pinta cada enlace en su sitio: internos como enlace interno, externos como enlace con su URL, bloqueados como aviso', async () => {
    render(<LinkLayer index={0} zoom={1} rotation={0} />);

    // El interno y la acción con nombre son enlaces de navegación con la misma etiqueta.
    const navigation = await screen.findAllByRole('link', { name: msg.internalLink });
    expect(navigation).toHaveLength(2);
    expect(navigation[0]).toHaveAttribute('href', '#');
    const external = screen.getByRole('link', { name: EXTERNAL });
    expect(external).toHaveAttribute('href', EXTERNAL);
    expect(external).toHaveAttribute('rel', 'noopener noreferrer');
    expect(external).toHaveAttribute('title', EXTERNAL);
    expect(screen.getByTitle(msg.linkBlocked)).not.toHaveAttribute('href');
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('la caja del enlace sale de los puntos PDF convertidos a píxeles (con la escala del zoom)', async () => {
    render(<LinkLayer index={0} zoom={2} rotation={0} />);
    const [internal] = await screen.findAllByRole('link', { name: msg.internalLink });
    if (internal === undefined) throw new Error('falta el enlace interno');
    // Rectángulo [72, 700, 300, 720] en puntos, con la escala que da el zoom 2 (zoomToScale).
    const scale = zoomToScale(2);
    expect(parseFloat(internal.style.left)).toBeCloseTo(72 * scale, 5);
    expect(parseFloat(internal.style.top)).toBeCloseTo((PAGE_HEIGHT - 720) * scale, 5);
    expect(parseFloat(internal.style.width)).toBeCloseTo(228 * scale, 5);
    expect(parseFloat(internal.style.height)).toBeCloseTo(20 * scale, 5);
  });

  it('un enlace interno navega al destino', async () => {
    const user = userEvent.setup();
    render(<LinkLayer index={0} zoom={1} rotation={0} />);
    const [internal] = await screen.findAllByRole('link', { name: msg.internalLink });
    if (internal === undefined) throw new Error('falta el enlace interno');
    await user.click(internal);
    expect(navigateToDest).toHaveBeenCalledWith('destino-final');
  });

  it('una acción con nombre se ejecuta', async () => {
    const user = userEvent.setup();
    render(<LinkLayer index={0} zoom={1} rotation={0} />);
    const navigation = await screen.findAllByRole('link', { name: msg.internalLink });
    const action = navigation[1];
    if (action === undefined) throw new Error('falta la acción con nombre');
    await user.click(action);
    expect(runNamedAction).toHaveBeenCalledWith('next-page');
  });

  it('un enlace bloqueado no hace nada: ni diálogo ni navegación', async () => {
    const user = userEvent.setup();
    const platform = createFakePlatform({ openExternalUrl: vi.fn(async () => ok(undefined)) });
    initServices({ platform, assetBaseUrl: '/pdfjs/' });
    render(<LinkLayer index={0} zoom={1} rotation={0} />);
    await user.click(await screen.findByTitle(msg.linkBlocked));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(navigateToDest).not.toHaveBeenCalled();
    expect(platform.openExternalUrl).not.toHaveBeenCalled();
  });

  it('un enlace externo pide confirmación; «Cancelar» no abre nada', async () => {
    const user = userEvent.setup();
    const platform = createFakePlatform({ openExternalUrl: vi.fn(async () => ok(undefined)) });
    initServices({ platform, assetBaseUrl: '/pdfjs/' });
    render(<LinkLayer index={0} zoom={1} rotation={0} />);

    await user.click(await screen.findByRole('link', { name: EXTERNAL }));
    const dialog = screen.getByRole('dialog', { name: msg.confirmExternalTitle });
    expect(within(dialog).getByText(msg.confirmExternal(EXTERNAL))).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: msg.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.openExternalUrl).not.toHaveBeenCalled();
  });

  it('«Abrir» en el diálogo abre la URL con el sistema; si falla, avisa', async () => {
    const user = userEvent.setup();
    const platform = createFakePlatform({
      openExternalUrl: vi.fn(async () => err(platformError('unsupported'))),
    });
    initServices({ platform, assetBaseUrl: '/pdfjs/' });
    render(<LinkLayer index={0} zoom={1} rotation={0} />);

    await user.click(await screen.findByRole('link', { name: EXTERNAL }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: msg.openLink }));

    await waitFor(() => { expect(useViewer.getState().notice?.text).toBe(msg.openLinkFailed); });
    expect(platform.openExternalUrl).toHaveBeenCalledWith(EXTERNAL);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
