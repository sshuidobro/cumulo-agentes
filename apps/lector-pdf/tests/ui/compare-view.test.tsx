// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { memorySource } from '@suite/platform';
import type { PageComparison } from '../../src/core/compare/compare';
import type { Word } from '../../src/core/compare/words';
import { useCompare, type CompareState } from '../../src/state/compare-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { CompareView } from '../../src/ui/compare/CompareView';
import { compareMsg } from '../../src/ui/messages-compare';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';

const IDLE: CompareState = { status: 'idle', otherName: null, results: [], progress: null, selected: null, cancelled: false };

/** Palabra de prueba en el ítem 0 de la página. */
function word(text: string): Word {
  return { text, start: { item: 0, offset: 0 }, end: { item: 0, offset: text.length } };
}

const CHANGE_PAGE_2: PageComparison = {
  kind: 'changed',
  page: 1,
  changes: [{ kind: 'replace', removed: [word('página')], added: [word('hoja')] }],
};
const ONLY_IN_B: PageComparison = { kind: 'only-in-b', page: 4 };
const TOO_DIFFERENT: PageComparison = { kind: 'too-different', page: 6 };

/** Deja el visor con un documento abierto de nombre `basic-5.pdf` y la comparación en el estado dado. */
function setComparison(state: Partial<CompareState>): void {
  useViewer.setState({ ...initialViewerState, status: 'ready', file: openedFile('basic-5.pdf', memorySource(new Uint8Array(1))) });
  useCompare.setState({ ...IDLE, otherName: 'basic-5-changed.pdf', status: 'done', ...state });
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: '/pdfjs/' });
});

afterEach(() => {
  useCompare.setState(IDLE);
  useViewer.setState(initialViewerState);
});

describe('CompareView (PDF-112)', () => {
  it('se presenta como diálogo con título, resumen y la fila «Página 2» con el cambio', () => {
    setComparison({ results: [CHANGE_PAGE_2] });
    render(<CompareView />);

    const dialog = screen.getByRole('dialog', { name: 'Comparar «basic-5.pdf» con «basic-5-changed.pdf»' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByText('1 cambio en 1 página')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Página 2 · Se ha cambiado “página” por “hoja”.' })).toBeInTheDocument();
    expect(screen.getByTestId('compare-pages')).toHaveTextContent(compareMsg.selectChange);
  });

  it('muestra «No hay diferencias» cuando termina sin cambios', () => {
    setComparison({ results: [] });
    render(<CompareView />);

    expect(screen.getByText(compareMsg.noChanges)).toBeInTheDocument();
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('describe las páginas solo en un lado y las muy distintas', () => {
    setComparison({ results: [ONLY_IN_B, TOO_DIFFERENT] });
    render(<CompareView />);

    expect(screen.getByRole('option', { name: 'Página 5 · La página 5 solo está en el otro documento.' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Página 7 · La página 7 es muy distinta/ })).toBeInTheDocument();
  });

  it('con las flechas se mueve por la lista y con Intro se selecciona el cambio', async () => {
    const user = userEvent.setup();
    setComparison({ results: [CHANGE_PAGE_2, ONLY_IN_B, TOO_DIFFERENT] });
    render(<CompareView />);

    const list = screen.getByRole('listbox', { name: compareMsg.listLabel });
    expect(list).toHaveFocus();
    const second = screen.getByRole('option', { name: /Página 5/ });
    await user.keyboard('{ArrowDown}');
    expect(list).toHaveAttribute('aria-activedescendant', second.id);

    await user.keyboard('{Enter}');
    expect(useCompare.getState().selected).toBe(1);
    expect(second).toHaveAttribute('aria-selected', 'true');
  });

  it('Escape cierra la comparación', async () => {
    const user = userEvent.setup();
    setComparison({ results: [CHANGE_PAGE_2] });
    render(<CompareView />);

    await user.keyboard('{Escape}');

    expect(useCompare.getState().status).toBe('idle');
  });

  it('durante la comparación muestra el progreso y el botón «Cancelar»; al terminar lo quita', () => {
    setComparison({ status: 'running', progress: { pagesDone: 2, totalPages: 5, changedPages: 1 }, results: [CHANGE_PAGE_2] });
    const { rerender } = render(<CompareView />);

    expect(screen.getByText('Comparando página 3 de 5…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: compareMsg.cancel })).toBeInTheDocument();

    useCompare.setState({ status: 'done', progress: { pagesDone: 5, totalPages: 5, changedPages: 1 } });
    rerender(<CompareView />);

    expect(screen.queryByRole('button', { name: compareMsg.cancel })).toBeNull();
    expect(screen.getByRole('button', { name: compareMsg.close })).toBeInTheDocument();
  });

  it('tras cancelar indica hasta qué página se ha comparado', () => {
    setComparison({ cancelled: true, progress: { pagesDone: 3, totalPages: 5000, changedPages: 1 }, results: [CHANGE_PAGE_2] });
    render(<CompareView />);

    expect(screen.getByText('Comparación cancelada: se muestran los cambios hasta la página 3.')).toBeInTheDocument();
  });
});
