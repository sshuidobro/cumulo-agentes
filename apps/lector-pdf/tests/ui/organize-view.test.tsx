// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memorySource } from '@suite/platform';
import { ok, type AppError, type Result } from '@suite/shared';
import type { DocOpsClient } from '../../src/core/doc-ops/client';
import type { LoadedPdf } from '../../src/engine';
import { PageDimsTable } from '../../src/core/page-dims';
import { initialPlan } from '../../src/core/organize/plan';
import type { PageRotation } from '../../src/core/pdf/page-tree';
import { renderPageToCanvas } from '../../src/engine/render';
import { useChoice } from '../../src/state/choice';
import { setDocOpsRunner } from '../../src/state/doc-ops';
import { registerPendingChanges } from '../../src/state/save-actions';
import { renderQueue } from '../../src/state/render-service';
import type * as OrganizeActions from '../../src/state/organize-actions';
import { saveOrganize } from '../../src/state/organize-actions';
import { initialOrganizeState, useOrganize } from '../../src/state/organize-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ChoiceDialog } from '../../src/ui/kit/ChoiceDialog';
import { OrganizeView } from '../../src/ui/organize/OrganizeView';
import { organizeCellDomId } from '../../src/ui/organize/OrganizeCell';
import { organizeMsg } from '../../src/ui/messages-organize';
import { propertiesMsg } from '../../src/ui/messages-properties';
import { DocumentMenu } from '../../src/ui/toolbar/DocumentMenu';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { initServices } from '../../src/state/services';
import { FakeResizeObserver } from '../setup/resize-observer';

// La cuadrícula dibuja con pdf.js: aquí cada miniatura se completa al instante y se cuentan las llamadas.
vi.mock('../../src/engine/render', () => ({
  renderPageToCanvas: vi.fn(async () => 'done' as const),
}));

// El guardado real lo prueba `organize-actions.test.ts`; aquí solo importa que la vista lo llame.
vi.mock('../../src/state/organize-actions', async (importOriginal) => {
  const actual = await importOriginal<typeof OrganizeActions>();
  return { ...actual, saveOrganize: vi.fn(async () => 'cancelled' as const) };
});

const FIXTURE = 'basic-5.pdf';
/** Giros de las 5 páginas de basic-5.pdf (sin girar). */
const ROTATIONS: readonly PageRotation[] = [0, 0, 0, 0, 0];

const GRID_W = 600;
const GRID_H = 600;
const HUGE = 100_000;

/** Documento visible con `count` páginas: `getPage` devuelve una página mínima y cuenta las peticiones. */
function fakePdf(count: number): LoadedPdf {
  const getPage = vi.fn(async (n: number) => ({ id: n, rotate: 0, cleanup: () => undefined }));
  return { numPages: count, doc: { numPages: count, getPage } } as unknown as LoadedPdf;
}

/**
 * Operaciones de PDF falsas: `page-rotations` devuelve los giros de basic-5.pdf. Los tests de jsdom no pueden
 * abrir ficheros reales (pdf.js y los fixtures necesitan Node); el lector real lo prueban los tests de `core/`.
 */
function fakeDocOps(rotations: readonly PageRotation[]): DocOpsClient {
  return {
    run<T>(): Promise<Result<T, AppError>> {
      return Promise.resolve(ok(rotations as unknown as T));
    },
    dispose: () => Promise.resolve(),
  };
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  setDocOpsRunner(fakeDocOps(ROTATIONS));
  FakeResizeObserver.instances = [];
  vi.mocked(renderPageToCanvas).mockClear();
  vi.mocked(saveOrganize).mockClear();
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile(FIXTURE, memorySource(new Uint8Array([0x25]))),
    pdf: fakePdf(5),
    dims: PageDimsTable.uniform(5, 612, 792, 0),
    dimsVersion: 1,
  });
});

afterEach(() => {
  renderQueue.cancelAll();
  setDocOpsRunner(null);
  registerPendingChanges(null);
  useOrganize.setState(initialOrganizeState);
  useChoice.setState({ active: null });
  useViewer.setState(initialViewerState);
});

/** Monta la vista como lo hace la app: el menú abre la cuadrícula cuando `open`. */
function Harness() {
  const open = useOrganize((s) => s.open);
  return (
    <>
      <DocumentMenu />
      {open && <OrganizeView />}
      <ChoiceDialog />
    </>
  );
}

/** Da tamaño al contenedor de la cuadrícula (en jsdom no hay diseño) y avisa al observador. */
function sizeGrid(grid: HTMLElement, width: number, height: number): void {
  Object.defineProperty(grid, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(grid, 'clientHeight', { configurable: true, value: height });
  Object.defineProperty(grid, 'scrollTop', { configurable: true, writable: true, value: 0 });
  act(() => {
    FakeResizeObserver.triggerResize(grid);
  });
}

function grid(): HTMLElement {
  return screen.getByRole('listbox', { name: organizeMsg.title });
}

/** Celdas de la cuadrícula (el selector de tamaño también tiene opciones: se excluye). */
function options(): HTMLElement[] {
  return within(grid()).queryAllByRole('option');
}

/** Abre «Organizar páginas» desde «Más acciones» con el teclado (Intro en el menú). */
async function openFromMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  act(() => {
    screen.getByRole('button', { name: propertiesMsg.moreActions }).focus();
  });
  await user.keyboard('{Enter}');
  const item = await screen.findByRole('menuitem', { name: organizeMsg.menuItem });
  act(() => {
    item.focus();
  });
  await user.keyboard('{Enter}');
  const list = await screen.findByRole('listbox', { name: organizeMsg.title });
  sizeGrid(list, GRID_W, GRID_H);
  await waitFor(() => {
    expect(options()).toHaveLength(5);
  });
  return list;
}

describe('Organizar páginas · vista (PDF-125)', () => {
  it('abrir con Intro desde el menú da el foco a la cuadrícula con 5 opciones; teclado para seleccionar, borrar, deshacer y girar', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const list = await openFromMenu(user);

    expect(list).toHaveFocus();
    expect(screen.getByText('5 páginas · 0 seleccionadas')).toBeInTheDocument();

    await user.keyboard('{ArrowRight}');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(screen.getByText('5 páginas · 2 seleccionadas')).toBeInTheDocument();

    await user.keyboard('{Delete}');
    expect(options()).toHaveLength(3);

    await user.keyboard('{Control>}z{/Control}');
    expect(options()).toHaveLength(5);

    await user.keyboard('{Home}{Control>}]{/Control}');
    expect(screen.getByRole('option', { name: 'Página 1, girada 90°' })).toBeInTheDocument();
    // El giro del hueco es absoluto: la miniatura se pide con 90°.
    await waitFor(() => {
      expect(vi.mocked(renderPageToCanvas).mock.calls.some((call) => call[2].rotation === 90)).toBe(true);
    });
  });

  it('Alt+→ mueve la página enfocada y su etiqueta muestra «(antes 1)»; Escape con cambios pregunta con tres opciones', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);

    await user.keyboard('{Home}{Alt>}{ArrowRight}{/Alt}');
    const moved = screen.getByRole('option', { name: 'Página 2' });
    expect(within(moved).getByText('(antes 1)')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('button', { name: organizeMsg.save })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: organizeMsg.discard })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: organizeMsg.cancel })).toBeInTheDocument();

    // «Cancelar» deja la vista abierta con el cambio.
    await user.click(within(dialog).getByRole('button', { name: organizeMsg.cancel }));
    expect(useOrganize.getState().open).toBe(true);
    expect(screen.getByRole('option', { name: 'Página 2' })).toBeInTheDocument();
  });

  it('Ctrl+S llama a saveOrganize', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);

    await user.keyboard('{Control>}s{/Control}');

    expect(vi.mocked(saveOrganize)).toHaveBeenCalledTimes(1);
  });

  it('el doble clic en una página con cambios sin guardar no cierra la vista', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);
    await user.keyboard('{Home}{Alt>}{ArrowRight}{/Alt}');

    await user.dblClick(screen.getByRole('option', { name: 'Página 3' }));

    expect(useOrganize.getState().open).toBe(true);
  });

  it('los botones de icono tienen nombre accesible y título con su atajo', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);

    const rotate = screen.getByRole('button', { name: organizeMsg.rotateLeft });
    expect(rotate).toHaveAttribute('title', expect.stringContaining(organizeMsg.rotateLeft));
    expect(rotate).toBeDisabled();
    expect(screen.getByRole('button', { name: organizeMsg.delete })).toHaveAttribute('title', expect.stringContaining(organizeMsg.delete));
    expect(screen.getByRole('button', { name: organizeMsg.undo })).toBeDisabled();
  });

  it('todos los botones de icono de la barra tienen aria-label y title no vacíos', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);

    const toolbar = screen.getByRole('toolbar', { name: organizeMsg.toolbar });
    // Los botones de icono no llevan texto; «Guardar» y «Cerrar» sí, y se excluyen.
    const iconButtons = within(toolbar)
      .getAllByRole('button')
      .filter((button) => button.textContent === '');
    expect(iconButtons).toHaveLength(6); // girar izq./der., eliminar, insertar en blanco, deshacer, rehacer
    for (const button of iconButtons) {
      expect(button.getAttribute('aria-label')?.trim()).toBeTruthy();
      expect(button.getAttribute('title')?.trim()).toBeTruthy();
    }
  });
});

describe('Organizar páginas · estados de la vista (PDF-125)', () => {
  it('guardando muestra la barra de progreso con el avance y «Cancelar» la deja con su plan', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await openFromMenu(user);

    act(() => {
      useOrganize.setState({ status: 'saving', progress: { done: 1, total: 4 } });
    });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '1');
    expect(bar).toHaveAttribute('aria-valuemax', '4');
    expect(screen.getByText(organizeMsg.saving(1, 4))).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: organizeMsg.cancel }));
    // Cancelar no cierra la vista: el plan sigue como estaba.
    expect(useOrganize.getState().open).toBe(true);
  });

  it('con error muestra el mensaje y «Cerrar» cierra la vista', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    act(() => {
      useOrganize.setState({ ...initialOrganizeState, open: true, status: 'error', error: 'El PDF no se puede leer.' });
    });

    expect(screen.getByRole('alert')).toHaveTextContent('El PDF no se puede leer.');
    await user.click(screen.getByRole('button', { name: organizeMsg.close }));

    expect(useOrganize.getState().open).toBe(false);
  });
});

describe('Organizar páginas · virtualización (PDF-125)', () => {
  it('con 100 000 huecos sin miniaturas monta como mucho 12 opciones y Fin lleva el foco a la última, que sigue montada', async () => {
    const user = userEvent.setup();
    useViewer.setState({ ...initialViewerState, status: 'ready' });
    const rotations = Array.from({ length: HUGE }, (): PageRotation => 0);
    useOrganize.setState({ ...initialOrganizeState, open: true, status: 'ready', rotations, plan: initialPlan(rotations) });
    render(<Harness />);
    const list = grid();
    sizeGrid(list, 232, GRID_H);

    expect(options().length).toBeGreaterThan(0);
    expect(options().length).toBeLessThanOrEqual(12);

    await user.keyboard('{End}');

    const last = organizeCellDomId(HUGE - 1);
    await waitFor(() => {
      expect(list).toHaveAttribute('aria-activedescendant', last);
    });
    expect(document.getElementById(last)).not.toBeNull();
    expect(options().length).toBeLessThanOrEqual(12);
  });
});
