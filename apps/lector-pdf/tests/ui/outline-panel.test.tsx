// @vitest-environment jsdom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorageStore, type Platform } from '@suite/platform';
import { ok } from '@suite/shared';
import { toOutlineNodes, initialExpanded, type RawOutlineItem } from '../../src/core/outline';
import type { LoadedPdf } from '../../src/engine';
import { navigateToDest, runNamedAction } from '../../src/state/history';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { Sidebar } from '../../src/ui/sidebar/Sidebar';
import { msg } from '../../src/ui/messages';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(async () => 'done' as const),
}));
vi.mock('../../src/state/history', () => ({
  navigateToDest: vi.fn(async () => undefined),
  runNamedAction: vi.fn(),
  goBack: vi.fn(),
  goForward: vi.fn(),
}));

const EXTERNAL = 'https://example.org/';

/** Índice de prueba: Capítulo 1 (con Sección 1.1 y 1.2), Capítulo 2 cerrado, enlace externo y bloqueado. */
const SAMPLE: RawOutlineItem[] = [
  {
    title: 'Capítulo 1',
    bold: true,
    count: 2,
    dest: 'c1',
    items: [
      { title: 'Sección 1.1', count: 0, dest: 's11', items: [{ title: 'Apartado 1.1.1', dest: 'a111' }] },
      { title: 'Sección 1.2', dest: 's12' },
    ],
  },
  { title: 'Capítulo 2', count: -1, dest: 'c2', items: [{ title: 'Sección 2.1', italic: true, dest: 's21' }] },
  { title: 'Sitio web', url: EXTERNAL },
  { title: 'Script', url: 'javascript:alert(1)' },
];

let platform: Platform;

/** Documento listo con el índice dado y el panel en «Marcadores». */
function openWithOutline(raw: RawOutlineItem[] | null): void {
  const outline = raw === null ? null : toOutlineNodes(raw);
  const doc = { numPages: 3, getPage: vi.fn(), getPageMode: vi.fn(async () => null) };
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    pdf: { numPages: 3, doc } as unknown as LoadedPdf,
    sidebar: 'outline',
    outline,
    outlineExpanded: outline === null ? new Set<string>() : initialExpanded(outline),
  });
}

function tree(): HTMLElement {
  return screen.getByRole('tree', { name: 'Marcadores' });
}

function row(title: string): HTMLElement {
  return within(tree()).getByRole('treeitem', { name: title });
}

beforeEach(() => {
  platform = createFakePlatform({
    prefs: createStorageStore(null, 'outline-ui-test.'),
    openExternalUrl: vi.fn(async () => ok(undefined)),
  });
  initServices({ platform, assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState(initialViewerState);
  vi.mocked(navigateToDest).mockClear();
  vi.mocked(runNamedAction).mockClear();
});

describe('Marcadores · estados', () => {
  it('mientras se lee el índice muestra «Cargando marcadores…»', () => {
    openWithOutline(null);
    render(<Sidebar />);
    expect(screen.getByRole('tab', { name: 'Marcadores' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('status')).toHaveTextContent(msg.loadingBookmarks);
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('un documento sin marcadores muestra «Este documento no tiene marcadores.»', () => {
    openWithOutline([]);
    render(<Sidebar />);
    expect(screen.getByText('Este documento no tiene marcadores.')).toBeInTheDocument();
    expect(screen.queryByRole('tree')).toBeNull();
  });

  it('el árbol enlaza sus filas con aria-level, aria-expanded y los títulos en negrita o cursiva', () => {
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    expect(tree()).toHaveAttribute('aria-label', 'Marcadores');
    expect(row('Capítulo 1')).toHaveAttribute('aria-level', '1');
    expect(row('Capítulo 1')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Sección 1.1')).toHaveAttribute('aria-level', '2');
    expect(row('Sección 1.2')).not.toHaveAttribute('aria-expanded');
    expect(row('Capítulo 2')).toHaveAttribute('aria-expanded', 'false');
    // Capítulo 2 está cerrado en el PDF: su sección no aparece en la lista.
    expect(within(tree()).queryByRole('treeitem', { name: 'Sección 2.1' })).toBeNull();
  });

  it('«Expandir todo» y «Contraer todo» cambian todos los marcadores con hijos', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    await user.click(screen.getByRole('button', { name: msg.expandAll }));
    expect(row('Capítulo 2')).toHaveAttribute('aria-expanded', 'true');
    expect(row('Sección 1.1')).toHaveAttribute('aria-expanded', 'true');
    await user.click(screen.getByRole('button', { name: msg.collapseAll }));
    expect(row('Capítulo 1')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Sección 1.1' })).toBeNull();
  });
});

describe('Marcadores · teclado', () => {
  it('→ expande, otra vez → primer hijo; ← vuelve al padre; Intro en Sección 1.1 llama a navigateToDest', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    act(() => tree().focus());
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-0');

    // Capítulo 1 ya está abierto en el PDF: → baja al primer hijo.
    await user.keyboard('{ArrowRight}');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-0.0');
    expect(row('Sección 1.1')).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowLeft}');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-0');

    // Sección 1.1 se mueve con las flechas; Intro la activa.
    await user.keyboard('{ArrowDown}{Enter}');
    expect(navigateToDest).toHaveBeenCalledWith('s11');
  });

  it('→ sobre un marcador cerrado lo despliega sin moverse; ← sobre uno abierto lo contrae', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    act(() => tree().focus());
    // Filas visibles: Capítulo 1, Sección 1.1, Sección 1.2, Capítulo 2 (cerrado), Sitio web, Script.
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-1');
    await user.keyboard('{ArrowRight}');
    expect(row('Capítulo 2')).toHaveAttribute('aria-expanded', 'true');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-1');
    await user.keyboard('{ArrowLeft}');
    expect(row('Capítulo 2')).toHaveAttribute('aria-expanded', 'false');
  });

  it('Inicio y Fin llevan a la primera y a la última fila visible', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    act(() => tree().focus());
    await user.keyboard('{End}');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-3');
    await user.keyboard('{Home}');
    expect(tree()).toHaveAttribute('aria-activedescendant', 'outline-0');
  });

  it('las flechas del árbol no pasan a los atajos globales (página siguiente)', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    const onWindowKey = vi.fn();
    window.addEventListener('keydown', onWindowKey);
    act(() => tree().focus());
    await user.keyboard('{ArrowDown}');
    window.removeEventListener('keydown', onWindowKey);
    expect(onWindowKey).not.toHaveBeenCalled();
  });
});

describe('Marcadores · activar', () => {
  it('un clic en un marcador interno va a su destino', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    await user.click(row('Capítulo 1'));
    expect(navigateToDest).toHaveBeenCalledWith('c1');
  });

  it('un clic en el chevrón despliega sin activar el marcador', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    const chevron = within(row('Capítulo 2')).getByText('▸');
    await user.click(chevron);
    expect(row('Capítulo 2')).toHaveAttribute('aria-expanded', 'true');
    expect(navigateToDest).not.toHaveBeenCalled();
  });

  it('un marcador externo pide confirmación; «Abrir» abre la URL y «Cancelar» no hace nada', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    await user.click(row('Sitio web'));
    const dialog = screen.getByRole('dialog', { name: msg.confirmExternalTitle });
    expect(within(dialog).getByText(msg.confirmExternal(EXTERNAL))).toBeInTheDocument();
    expect(platform.openExternalUrl).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole('button', { name: msg.cancel }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(platform.openExternalUrl).not.toHaveBeenCalled();

    await user.click(row('Sitio web'));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: msg.openLink }));
    expect(platform.openExternalUrl).toHaveBeenCalledWith(EXTERNAL);
  });

  it('un marcador bloqueado muestra el aviso de enlace bloqueado', async () => {
    const user = userEvent.setup();
    openWithOutline(SAMPLE);
    render(<Sidebar />);
    await user.click(row('Script'));
    expect(useViewer.getState().notice?.text).toBe(msg.linkBlocked);
    expect(navigateToDest).not.toHaveBeenCalled();
    expect(platform.openExternalUrl).not.toHaveBeenCalled();
  });

  it('un marcador con acción con nombre ejecuta esa acción', async () => {
    const user = userEvent.setup();
    openWithOutline([{ title: 'Siguiente', action: { name: 'NextPage' } }]);
    render(<Sidebar />);
    await user.click(row('Siguiente'));
    expect(runNamedAction).toHaveBeenCalledWith('next-page');
  });
});

describe('Marcadores · virtualización', () => {
  it('con 5 000 marcadores visibles, el DOM solo monta las filas de la ventana (menos de 60 treeitem)', () => {
    const big: RawOutlineItem[] = Array.from({ length: 5000 }, (_, i) => ({ title: `Punto ${String(i + 1)}`, dest: 'p' }));
    openWithOutline(big);
    // Altura de la ventana simulada (jsdom no hace layout): unas 20 filas visibles.
    const heightSpy = vi.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(600);
    try {
      render(<Sidebar />);
      const items = screen.getAllByRole('treeitem');
      expect(items.length).toBeGreaterThan(0);
      expect(items.length).toBeLessThan(60);
      expect(screen.getByRole('treeitem', { name: 'Punto 1' })).toBeInTheDocument();
      expect(screen.queryByRole('treeitem', { name: 'Punto 5000' })).toBeNull();
    } finally {
      heightSpy.mockRestore();
    }
  });
});
