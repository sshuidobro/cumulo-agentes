// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { EditableLine } from '../../src/core/edit-text';
import type { PageViewport } from '../../src/engine/pdfjs';
import { App } from '../../src/ui/App';
import { editMsg } from '../../src/ui/messages-edit';
import { editTextMsg } from '../../src/ui/messages-edit-text';
import { EditTextLayer } from '../../src/ui/viewer/EditTextLayer';
import { endAnnotationSession, setTool } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { editTextRedo, editTextUndo, setEditTextTool } from '../../src/state/edit-text-actions';
import { initialEditTextState, useEditText, type LineEditDraft } from '../../src/state/edit-text-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { createFakePlatform } from '../helpers/fake-platform';

/** Página de 792 pt de alto a escala 2, sin rotación (la matriz de pdf.js: y hacia abajo). */
const PAGE_HEIGHT = 792;
const SCALE = 2;

function fakeViewport(): PageViewport {
  return {
    width: 612 * SCALE,
    height: PAGE_HEIGHT * SCALE,
    transform: [SCALE, 0, 0, -SCALE, 0, PAGE_HEIGHT * SCALE],
    convertToViewportPoint: (x: number, y: number) => [x * SCALE, (PAGE_HEIGHT - y) * SCALE],
    convertToPdfPoint: (x: number, y: number) => [x / SCALE, PAGE_HEIGHT - y / SCALE],
  } as unknown as PageViewport;
}

/** Línea de la página 2 (índice 1) con la fuente indicada. */
function lineWith(family: EditableLine['style']['font']['family'], bold = false, italic = false): EditableLine {
  return {
    pageIndex: 1,
    bounds: [72, 700, 300, 712],
    origin: [72, 702],
    style: { font: { family, bold, italic }, fontSize: 12, color: [0, 0, 0] },
  };
}

const ORIGINAL = 'Texto de búsqueda en la página dos.';

/** Abre el cuadro de la línea `line` (sin ediciones previas). */
function openEditor(line: EditableLine, original = ORIGINAL): void {
  useEditText.setState({
    active: true,
    editing: { pageIndex: 1, hint: line.bounds, line, original, editId: null },
  });
}

function draftOf(text: string, line: EditableLine = lineWith('Helvetica')): LineEditDraft {
  return { id: 'edit-1', pageIndex: 1, hint: line.bounds, line, original: ORIGINAL, text };
}

function renderLayer(): void {
  render(<EditTextLayer pageIndex={1} viewport={fakeViewport()} night={false} />);
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState({ ...initialViewerState, status: 'ready' });
  useEditText.setState(initialEditTextState);
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
  useEditText.setState(initialEditTextState);
});

describe('botón «Editar texto» en la barra «Editar» (PDF-147)', () => {
  it('se activa y desactiva con aria-pressed; activarlo quita la herramienta de anotación', async () => {
    const user = userEvent.setup();
    setTool('redact');
    render(<App />);
    await user.click(screen.getByRole('button', { name: editMsg.editButton }));
    const toolbar = await screen.findByRole('toolbar', { name: editMsg.editButton });
    const toggle = within(toolbar).getByRole('button', { name: editTextMsg.tool });

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(toggle).toHaveAttribute('title', expect.stringContaining(editTextMsg.toolHint));

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(useEditText.getState().active).toBe(true);
    expect(useAnnotations.getState().tool).toBe('none');

    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(useEditText.getState().active).toBe(false);
  });

  it('activar otra herramienta de anotación desactiva «Editar texto»', () => {
    setEditTextTool(true);
    expect(useEditText.getState().active).toBe(true);
    setTool('page-text');
    expect(useEditText.getState().active).toBe(false);
  });

  it('con ediciones muestra el contador y «Guardar»', async () => {
    const user = userEvent.setup();
    useEditText.setState({ edits: [draftOf('Texto nuevo')] });
    render(<App />);
    await user.click(screen.getByRole('button', { name: editMsg.editButton }));
    const toolbar = await screen.findByRole('toolbar', { name: editMsg.editButton });

    expect(within(toolbar).getByRole('status')).toHaveTextContent(editTextMsg.edited(1));
    expect(within(toolbar).getByRole('button', { name: editTextMsg.save })).toBeInTheDocument();
  });
});

describe('cuadro de edición sobre la línea (PDF-147)', () => {
  it('muestra el texto original y tiene nombre accesible con la página', () => {
    openEditor(lineWith('Helvetica'));
    renderLayer();
    const input = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });
    expect(input).toHaveValue(ORIGINAL);
    expect(input).toHaveFocus();
  });

  it('usa una letra con serifas para una línea Times y monoespaciada para Courier', () => {
    openEditor(lineWith('Times'));
    const { unmount } = render(<EditTextLayer pageIndex={1} viewport={fakeViewport()} night={false} />);
    expect(screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) }).style.fontFamily).toContain('Times New Roman');
    unmount();

    useEditText.setState({ editing: null });
    openEditor(lineWith('Courier', true));
    renderLayer();
    const courier = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });
    expect(courier.style.fontFamily).toContain('Courier New');
    expect(courier.style.fontFamily).toContain('monospace');
    expect(courier.style.fontWeight).toBe('bold');
  });

  it('Enter confirma el texto nuevo y crea una edición; la caja nueva tiene nombre accesible', async () => {
    const user = userEvent.setup();
    openEditor(lineWith('Helvetica'));
    renderLayer();
    const input = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });

    await user.clear(input);
    await user.type(input, 'Texto de búsqueda en la hoja dos.{Enter}');

    expect(useEditText.getState().editing).toBeNull();
    expect(useEditText.getState().edits).toHaveLength(1);
    expect(useEditText.getState().edits[0]?.text).toBe('Texto de búsqueda en la hoja dos.');
    expect(screen.getByRole('button', { name: editTextMsg.editBoxLabel(2, 'Texto de búsqueda en la hoja dos.') })).toBeInTheDocument();
  });

  it('Escape cancela: no crea edición', async () => {
    const user = userEvent.setup();
    openEditor(lineWith('Helvetica'));
    renderLayer();
    const input = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });

    await user.clear(input);
    await user.type(input, 'Otro texto{Escape}');

    expect(useEditText.getState().editing).toBeNull();
    expect(useEditText.getState().edits).toHaveLength(0);
  });

  it('un carácter que la fuente estándar no admite muestra el aviso y Enter no cierra el cuadro', async () => {
    const user = userEvent.setup();
    openEditor(lineWith('Helvetica'));
    renderLayer();
    const input = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });

    await user.clear(input);
    await user.type(input, 'Feliz 😀{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent(editTextMsg.unsupportedChar('😀'));
    expect(useEditText.getState().editing).not.toBeNull();
    expect(useEditText.getState().edits).toHaveLength(0);
  });

  it('pasa el fondo de papel: blanco en página normal y el oscuro en modo noche', () => {
    openEditor(lineWith('Helvetica'));
    const { unmount } = render(<EditTextLayer pageIndex={1} viewport={fakeViewport()} night={false} />);
    expect(screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) }).style.background).toContain('rgb(255, 255, 255)');
    unmount();
    render(<EditTextLayer pageIndex={1} viewport={fakeViewport()} night />);
    expect(screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) }).style.background).toContain('rgb(31, 31, 35)');
  });
});

describe('ediciones sobre la página (PDF-147)', () => {
  it('Supr con la edición enfocada la restaura (quita la edición)', async () => {
    const user = userEvent.setup();
    useEditText.setState({ edits: [draftOf('Texto nuevo')] });
    renderLayer();
    const box = screen.getByRole('button', { name: editTextMsg.editBoxLabel(2, 'Texto nuevo') });
    box.focus();
    await user.keyboard('{Delete}');
    expect(useEditText.getState().edits).toHaveLength(0);
  });

  it('Ctrl+Z quita la edición y Ctrl+Y la repone', async () => {
    const user = userEvent.setup();
    setEditTextTool(true);
    openEditor(lineWith('Helvetica'));
    renderLayer();
    const input = screen.getByRole('textbox', { name: editTextMsg.editorLabel(2) });
    await user.clear(input);
    await user.type(input, 'Texto nuevo{Enter}');
    expect(useEditText.getState().edits).toHaveLength(1);

    editTextUndo();
    expect(useEditText.getState().edits).toHaveLength(0);
    editTextRedo();
    expect(useEditText.getState().edits).toHaveLength(1);
  });

  it('Escape con el cuadro cerrado desactiva la herramienta', async () => {
    const user = userEvent.setup();
    render(<App />);
    setEditTextTool(true);
    expect(useEditText.getState().active).toBe(true);
    await user.keyboard('{Escape}');
    expect(useEditText.getState().active).toBe(false);
  });
});
