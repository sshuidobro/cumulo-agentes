// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type OpenedFile, type Platform } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readCipher } from '../../src/engine';
import { combineFiles, useCombineDialog, type CombineItem } from '../../src/state/combine-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { CombineDialog } from '../../src/ui/organize/CombineDialog';
import { organizeMsg } from '../../src/ui/messages-organize';
import { createFakePlatform } from '../helpers/fake-platform';

vi.mock('../../src/engine', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCipher: vi.fn(async () => 'none'),
}));

vi.mock('../../src/state/combine-actions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  combineFiles: vi.fn(async () => 'saved'),
}));

let platform: Platform;

/** Elementos de disco sin contraseña, con ids file-1, file-2… y páginas 1, 2…, en el orden dado. */
function itemsOf(...names: string[]): CombineItem[] {
  return names.map((name, index) => ({
    id: `file-${String(index + 1)}`,
    name,
    pages: index + 1,
    source: { bytes: new Uint8Array([1]), password: null },
  }));
}

function rows(): HTMLElement[] {
  return within(screen.getByRole('listbox', { name: organizeMsg.combineTitle }))
    .getAllByRole('option');
}

beforeEach(() => {
  platform = createFakePlatform();
  initServices({ platform, assetBaseUrl: '/' });
  const file: OpenedFile = {
    token: 'fake',
    name: 'informe.pdf',
    path: null,
    size: 10,
    lastModified: null,
    canSaveInPlace: false,
    source: memorySource(new Uint8Array(0)),
  };
  useViewer.setState({ ...initialViewerState, status: 'ready', file });
  vi.mocked(readCipher).mockResolvedValue('none');
});

afterEach(() => {
  useCombineDialog.setState({ open: false, items: [] });
  vi.mocked(combineFiles).mockClear();
});

describe('CombineDialog', () => {
  it('muestra la lista en orden con su número de páginas, y «Combinar» solo con dos o más', () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf') });
    render(<CombineDialog />);

    expect(rows().map((row) => row.textContent)).toEqual(['a.pdf1 página', 'b.pdf2 páginas']);
    expect(screen.getByRole('button', { name: organizeMsg.combineAction })).toBeEnabled();
  });

  it('con un solo elemento «Combinar» está deshabilitado y se explica', () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf') });
    render(<CombineDialog />);

    expect(screen.getByRole('button', { name: organizeMsg.combineAction })).toBeDisabled();
    expect(screen.getByText(organizeMsg.combineHint)).toBeInTheDocument();
  });

  it('«Bajar» de la primera fila la pone segunda; el botón lleva el nombre del fichero', async () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf') });
    render(<CombineDialog />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${organizeMsg.moveDown} a.pdf` }));

    expect(useCombineDialog.getState().items.map((item) => item.name)).toEqual(['b.pdf', 'a.pdf']);
  });

  it('Alt+↓ mueve el elemento con foco y el foco lo sigue', async () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf', 'c.pdf') });
    render(<CombineDialog />);
    const user = userEvent.setup();
    const first = rows()[0];
    expect(first).toBeDefined();
    if (first === undefined) return;

    await act(async () => {
      first.focus();
    });
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(useCombineDialog.getState().items.map((item) => item.name)).toEqual(['b.pdf', 'a.pdf', 'c.pdf']);
    expect(document.activeElement?.textContent).toContain('a.pdf');
  });

  it('«Quitar» elimina el elemento de la lista', async () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf') });
    render(<CombineDialog />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: `${organizeMsg.remove} b.pdf` }));

    expect(useCombineDialog.getState().items.map((item) => item.name)).toEqual(['a.pdf']);
  });

  it('con un fichero protegido avisa de que el PDF nuevo no tendrá contraseña', () => {
    const items = itemsOf('a.pdf', 'b.pdf');
    const [first, second] = items;
    if (first === undefined || second === undefined) throw new Error('faltan elementos');
    useCombineDialog.setState({
      open: true,
      items: [first, { ...second, source: { bytes: new Uint8Array([1]), password: 'usuario' } }],
    });
    render(<CombineDialog />);

    expect(screen.getByText(organizeMsg.newIsUnprotected)).toBeInTheDocument();
  });

  it('pulsar «Combinar» llama a combineFiles', async () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf') });
    render(<CombineDialog />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: organizeMsg.combineAction }));

    expect(combineFiles).toHaveBeenCalledTimes(1);
  });

  it('Escape cierra el diálogo', () => {
    useCombineDialog.setState({ open: true, items: itemsOf('a.pdf', 'b.pdf') });
    render(<CombineDialog />);

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });

    expect(useCombineDialog.getState().open).toBe(false);
  });
});
