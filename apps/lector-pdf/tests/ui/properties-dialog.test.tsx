// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource, type OpenedFile } from '@suite/platform';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { LoadedPdf } from '../../src/engine';
import { useShortcuts } from '../../src/ui/use-shortcuts';
import { DocumentMenu } from '../../src/ui/toolbar/DocumentMenu';
import { PropertiesDialog } from '../../src/ui/properties/PropertiesDialog';
import { openProperties, usePropertiesDialog } from '../../src/state/properties-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Documento de prueba: solo lo que lee el diálogo (metadatos, marca de etiquetado y una página de 595 × 842). */
function fakePdf(numPages: number, gate: Promise<void> = Promise.resolve()): LoadedPdf {
  const doc = {
    numPages,
    getMetadata: () => gate.then(() => ({
      info: {
        Title: 'Informe anual',
        Author: 'Ana Pérez',
        PDFFormatVersion: '1.7',
        CreationDate: 'D:20200104120000Z',
        IsLinearized: true,
      },
      metadata: null,
    })),
    getMarkInfo: () => Promise.resolve(new Map<string, boolean>([['Marked', true]])),
    getPage: () => Promise.resolve({ pageNumber: 1, rotate: 0, getViewport: () => ({ width: 595, height: 842 }) }),
    destroy: () => Promise.resolve(),
  };
  return {
    doc,
    numPages,
    fingerprint: 'fake',
    onIoError: () => () => undefined,
    destroy: () => Promise.resolve(),
  } as unknown as LoadedPdf;
}

const file: OpenedFile = {
  token: 'fake',
  name: 'informe.pdf',
  path: null,
  size: 2048,
  lastModified: null,
  canSaveInPlace: false,
  source: memorySource(new Uint8Array(0)),
};

/** Valor de la fila cuya etiqueta es `label` (dt → dd). */
function valueOf(dialog: HTMLElement, label: string): string {
  const term = within(dialog).getByText(label, { selector: 'dt' });
  return term.nextElementSibling?.textContent ?? '';
}

/** Monta el menú, el diálogo y el atajo Ctrl+D como lo hace la app (VIEW_SHORTCUTS). */
function Harness() {
  useShortcuts({ properties: () => { openProperties(); } });
  return (
    <header>
      <DocumentMenu />
      <button type="button">Otro botón</button>
      <PropertiesDialog />
    </header>
  );
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  usePropertiesDialog.setState({ open: false });
  useViewer.setState({ ...initialViewerState, status: 'ready', pdf: fakePdf(5), file, currentPage: 0 });
});

afterEach(() => {
  usePropertiesDialog.setState({ open: false });
  useViewer.setState(initialViewerState);
});

describe('menú «Más acciones»', () => {
  it('está deshabilitado sin documento abierto', () => {
    useViewer.setState(initialViewerState);
    render(<Harness />);
    expect(screen.getByRole('button', { name: 'Más acciones' })).toBeDisabled();
  });

  it('abre «Propiedades del documento…» con su atajo visible y el foco en la primera entrada', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    const item = screen.getByRole('menuitem', { name: 'Propiedades del documento…' });
    expect(item).toHaveFocus();
    expect(item).toHaveAttribute('title', 'Propiedades del documento… (Ctrl+D)');
    expect(within(item).getByText('Ctrl+D', { exact: false })).toBeInTheDocument();
  });

  it('con Intro en la entrada abre el diálogo y, al cerrarlo con Esc, el foco vuelve al botón del menú', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Más acciones' }));
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    expect(dialog).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: 'Más acciones' })).toHaveFocus();
  });
});

describe('diálogo de propiedades', () => {
  it('Ctrl+D lo abre, lee las propiedades y las muestra en «Descripción»', async () => {
    const user = userEvent.setup();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    useViewer.setState({ pdf: fakePdf(5, gate) });
    render(<Harness />);
    await user.keyboard('{Control>}d{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    expect(within(dialog).getByText('Leyendo propiedades…')).toBeInTheDocument();
    release();
    expect(await within(dialog).findByText('Informe anual')).toBeInTheDocument();
    expect(within(dialog).queryByText('Leyendo propiedades…')).toBeNull();
    expect(valueOf(dialog, 'Fichero')).toBe('informe.pdf');
    expect(valueOf(dialog, 'Ruta')).toBe('—');
    expect(within(dialog).getByText('Ana Pérez')).toBeInTheDocument();
    expect(valueOf(dialog, 'Asunto')).toBe('—');
    expect(within(dialog).getByRole('tab', { name: 'Descripción' })).toHaveAttribute('aria-selected', 'true');
  });

  it('el foco entra en el diálogo al abrirse', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Control>}d{/Control}');
    await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    expect(screen.getByRole('tab', { name: 'Descripción' })).toHaveFocus();
  });

  it('con ←/→ cambia a «Avanzado», que muestra páginas, versión, etiquetado y vista web rápida', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Control>}d{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    await within(dialog).findByText('Informe anual');
    await user.keyboard('{ArrowRight}');
    const advanced = within(dialog).getByRole('tab', { name: 'Avanzado' });
    expect(advanced).toHaveFocus();
    expect(advanced).toHaveAttribute('aria-selected', 'true');
    expect(valueOf(dialog, 'Páginas')).toBe('5');
    expect(valueOf(dialog, 'Versión PDF')).toBe('1.7');
    expect(valueOf(dialog, 'Tamaño de página')).toBe('A4 (210 × 297 mm)');
    expect(valueOf(dialog, 'Tamaño del fichero')).toBe('2,0 KB (2.048 bytes)');
    expect(valueOf(dialog, 'PDF etiquetado')).toBe('Sí');
    expect(valueOf(dialog, 'Vista web rápida')).toBe('Sí');
    expect(valueOf(dialog, 'Cifrado')).toBe('No');
    expect(valueOf(dialog, 'Formulario')).toBe('No');
    await user.keyboard('{ArrowLeft}');
    expect(within(dialog).getByRole('tab', { name: 'Descripción' })).toHaveFocus();
  });

  it('muestra la fecha de creación en español', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Control>}d{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    await within(dialog).findByText('Informe anual');
    expect(within(dialog).getByText(/4 de enero de 2020/)).toBeInTheDocument();
  });

  it('Esc lo cierra sin que el atajo llegue a la ventana', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.keyboard('{Control>}d{/Control}');
    await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    await user.keyboard('{Escape}');
    await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull(); });
  });

  it('el botón «Cerrar» cierra el diálogo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => { openProperties(); });
    const dialog = await screen.findByRole('dialog', { name: 'Propiedades del documento' });
    await user.click(within(dialog).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('no se abre sin documento', async () => {
    useViewer.setState(initialViewerState);
    render(<Harness />);
    act(() => { openProperties(); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
