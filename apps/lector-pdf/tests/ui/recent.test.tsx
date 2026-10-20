// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err } from '@suite/shared';
import { platformError, type Platform, type RecentFile } from '@suite/platform';
import { EmptyState } from '../../src/ui/open/EmptyState';
import { RecentMenu } from '../../src/ui/toolbar/RecentMenu';
import { useRecent } from '../../src/state/recent-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/state/document-actions', () => ({ pickAndOpen: vi.fn(async () => undefined), openRequested: vi.fn(async () => undefined) }));

const RECENTS: RecentFile[] = [
  { id: 'links', name: 'links.pdf', path: '/home/ana/docs/links.pdf', size: 10, openedAt: Date.now(), available: true },
  { id: 'basic', name: 'basic-5.pdf', path: '/home/ana/docs/basic-5.pdf', size: 20, openedAt: Date.now() - 86_400_000 * 3, available: false },
];

/** Entorno web con File System Access (el selector del navegador existe). */
function withFileSystemAccess(): void {
  Object.defineProperty(window, 'showOpenFilePicker', { value: vi.fn(), configurable: true, writable: true });
}

let platform: Platform;

/** Elemento de una lista en la posición `i` (la prueba falla si no existe). */
function itemAt(items: readonly HTMLElement[], i: number): HTMLElement {
  const item = items[i];
  if (item === undefined) throw new Error(`No hay elemento ${String(i)}`);
  return item;
}

function setup(overrides: Partial<Platform> = {}): void {
  platform = createFakePlatform({
    kind: 'tauri',
    recentFiles: vi.fn(async () => RECENTS),
    openRecent: vi.fn(async () => err(platformError('not-found'))),
    ...overrides,
  });
  initServices({ platform, assetBaseUrl: 'http://localhost/pdfjs/' });
}

beforeEach(() => {
  useViewer.setState(initialViewerState);
  useRecent.setState({ list: RECENTS, loading: false });
  setup();
});

afterEach(() => {
  delete (window as { showOpenFilePicker?: unknown }).showOpenFilePicker;
});

describe('pantalla de inicio: recientes', () => {
  it('lista los recientes con el nombre, la carpeta y la fecha, en orden', () => {
    render(<EmptyState />);
    const section = screen.getByRole('region', { name: 'Recientes' });
    const items = within(section).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(itemAt(items, 0)).getByRole('button', { name: 'links.pdf' })).toBeEnabled();
    expect(within(itemAt(items, 0)).getByText('/home/ana/docs')).toBeInTheDocument();
    expect(within(itemAt(items, 0)).getByText(/^hoy, \d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it('una entrada no disponible aparece deshabilitada, con «No disponible» y «Quitar de la lista»', () => {
    render(<EmptyState />);
    const items = within(screen.getByRole('region', { name: 'Recientes' })).getAllByRole('listitem');
    expect(within(itemAt(items, 1)).getByRole('button', { name: 'basic-5.pdf' })).toBeDisabled();
    expect(within(itemAt(items, 1)).getByText('No disponible')).toBeInTheDocument();
    expect(within(itemAt(items, 1)).getByRole('button', { name: 'Quitar de la lista' })).toBeEnabled();
  });

  it('«Quitar de la lista» llama a la plataforma y refresca la lista', async () => {
    const user = userEvent.setup();
    render(<EmptyState />);
    platform.recentFiles = vi.fn(async () => RECENTS.slice(0, 1));
    await user.click(screen.getByRole('button', { name: 'Quitar de la lista' }));
    expect(platform.removeRecent).toHaveBeenCalledWith('basic');
    expect(useRecent.getState().list.map((e) => e.id)).toEqual(['links']);
  });

  it('elegir un reciente lo reabre por su identificador', async () => {
    const user = userEvent.setup();
    render(<EmptyState />);
    await user.click(screen.getByRole('button', { name: 'links.pdf' }));
    expect(platform.openRecent).toHaveBeenCalledWith('links');
  });

  it('sin recientes no muestra la sección', () => {
    useRecent.setState({ list: [], loading: false });
    render(<EmptyState />);
    expect(screen.queryByRole('region', { name: 'Recientes' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Recientes' })).not.toBeInTheDocument();
  });

  it('en web sin File System Access explica que no se pueden reabrir recientes', () => {
    setup({ kind: 'web' });
    useRecent.setState({ list: [], loading: false });
    render(<EmptyState />);
    expect(screen.getByText('Este navegador no permite reabrir ficheros recientes.')).toBeInTheDocument();
  });

  it('en web con File System Access muestra la lista sin el aviso', () => {
    withFileSystemAccess();
    setup({ kind: 'web' });
    render(<EmptyState />);
    expect(screen.getByRole('region', { name: 'Recientes' })).toBeInTheDocument();
    expect(screen.queryByText('Este navegador no permite reabrir ficheros recientes.')).not.toBeInTheDocument();
  });
});

describe('menú «Abrir recientes»', () => {
  it('deshabilitado sin recientes', () => {
    useRecent.setState({ list: [], loading: false });
    render(<RecentMenu />);
    expect(screen.getByRole('button', { name: 'Abrir recientes' })).toBeDisabled();
  });

  it('muestra los recientes, un separador y «Borrar la lista de recientes»', async () => {
    const user = userEvent.setup();
    render(<RecentMenu />);
    await user.click(screen.getByRole('button', { name: 'Abrir recientes' }));
    const menu = screen.getByRole('menu', { name: 'Abrir recientes' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
      'links.pdf',
      'basic-5.pdf',
      'Borrar la lista de recientes',
    ]);
    expect(within(menu).getByRole('separator')).toBeInTheDocument();
  });

  it('elegir un reciente lo reabre', async () => {
    const user = userEvent.setup();
    render(<RecentMenu />);
    await user.click(screen.getByRole('button', { name: 'Abrir recientes' }));
    await user.click(screen.getByRole('menuitem', { name: 'links.pdf' }));
    expect(platform.openRecent).toHaveBeenCalledWith('links');
  });

  it('«Borrar la lista de recientes» vacía la lista y deshabilita el menú', async () => {
    const user = userEvent.setup();
    render(<RecentMenu />);
    await user.click(screen.getByRole('button', { name: 'Abrir recientes' }));
    platform.recentFiles = vi.fn(async () => []);
    await user.click(screen.getByRole('menuitem', { name: 'Borrar la lista de recientes' }));
    expect(platform.clearRecents).toHaveBeenCalledOnce();
    expect(useRecent.getState().list).toEqual([]);
    expect(screen.getByRole('button', { name: 'Abrir recientes' })).toBeDisabled();
  });
});
