// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FormField } from '../../src/core/forms';
import type { PageViewport } from '../../src/engine/pdfjs';
import { setFieldValue } from '../../src/state/form-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { useAppearance } from '../../src/state/appearance-store';
import { useForms } from '../../src/state/form-store';
import { FormLayer } from '../../src/ui/viewer/FormLayer';

vi.mock('../../src/state/form-actions', () => ({ setFieldValue: vi.fn() }));

/** Alto de la página de prueba en puntos: el viewport convierte puntos PDF (origen abajo) a píxeles (origen arriba). */
const PAGE_HEIGHT = 792;

/** Viewport de prueba a la escala pedida (1 punto = `scale` píxeles). */
function fakeViewport(scale = 1): PageViewport {
  return {
    scale,
    convertToViewportPoint: (x: number, y: number) => [x * scale, (PAGE_HEIGHT - y) * scale],
  } as unknown as PageViewport;
}

/** Campo de prueba con sus valores por defecto; `over` cambia lo que haga falta. */
function field(over: Partial<FormField> & Pick<FormField, 'name' | 'type' | 'widgets'>): FormField {
  return {
    readOnly: false,
    required: false,
    multiline: false,
    password: false,
    comb: false,
    maxLen: 0,
    multiSelect: false,
    editable: false,
    options: [],
    align: 0,
    fontSize: 12,
    textColor: [0, 0, 0],
    tooltip: '',
    initial: { kind: 'text', text: '' },
    ...over,
  };
}

const widget = (id: string, pageIndex: number, rect: [number, number, number, number]) => ({
  id,
  ref: { num: Number(id.replace('R', '')), gen: 0 },
  pageIndex,
  rect,
  onState: null,
  rotation: 0 as const,
  background: null,
  border: null,
});

const nombre = field({
  name: 'nombre',
  type: 'text',
  initial: { kind: 'text', text: 'Ana' },
  widgets: [widget('1R', 0, [72, 760, 300, 780]), widget('9R', 1, [72, 760, 300, 780])],
});
const comentarios = field({
  name: 'comentarios',
  type: 'text',
  multiline: true,
  widgets: [widget('2R', 0, [72, 640, 523, 740])],
});
const codigo = field({ name: 'codigo', type: 'text', maxLen: 6, widgets: [widget('3R', 0, [72, 600, 222, 620])] });
const importe = field({
  name: 'importe',
  type: 'text',
  align: 2,
  initial: { kind: 'text', text: '12,50' },
  widgets: [widget('4R', 0, [320, 600, 420, 620])],
});
const pais = field({
  name: 'pais',
  type: 'combo',
  options: [
    { exportValue: 'es', displayValue: 'España' },
    { exportValue: 'fr', displayValue: 'Francia' },
    { exportValue: 'pt', displayValue: 'Portugal' },
  ],
  initial: { kind: 'choice', selected: ['es'] },
  widgets: [widget('5R', 0, [72, 470, 252, 490])],
});
const idiomas = field({
  name: 'idiomas',
  type: 'list',
  multiSelect: true,
  options: [
    { exportValue: 'es', displayValue: 'Español' },
    { exportValue: 'en', displayValue: 'Inglés' },
    { exportValue: 'fr', displayValue: 'Francés' },
  ],
  initial: { kind: 'choice', selected: ['es', 'en'] },
  widgets: [widget('6R', 0, [320, 430, 470, 490])],
});
const apellido = field({ name: 'persona.apellido', type: 'text', widgets: [widget('7R', 0, [72, 400, 300, 420])] });
const soloLectura = field({
  name: 'solo_lectura',
  type: 'text',
  readOnly: true,
  initial: { kind: 'text', text: 'No editable' },
  widgets: [widget('8R', 0, [320, 400, 523, 420])],
});
const obligatorio = field({
  name: 'obligatorio',
  type: 'text',
  required: true,
  tooltip: 'Campo obligatorio',
  widgets: [widget('10R', 0, [72, 360, 300, 380])],
});
const rotado = field({ name: 'rotado', type: 'text', widgets: [widget('11R', 0, [540, 600, 560, 760])] });
/** Campo de otra página: no debe aparecer en la página 0. */
const otraPagina = field({ name: 'otra', type: 'text', widgets: [widget('12R', 1, [72, 700, 300, 720])] });

const PAGE_ONE = [nombre, comentarios, codigo, importe, pais, idiomas, apellido, soloLectura, obligatorio, rotado];

function setForms(list: readonly FormField[], options: { highlight?: boolean } = {}): void {
  const fields = new Map(list.map((f) => [f.name, f]));
  const byPage = new Map<number, string[]>();
  for (const f of list) {
    // Como el store real: cada nombre aparece una vez por página.
    for (const w of f.widgets) {
      const names = byPage.get(w.pageIndex) ?? [];
      if (!names.includes(f.name)) byPage.set(w.pageIndex, [...names, f.name]);
    }
  }
  useForms.setState({ fields, byPage, highlight: options.highlight ?? true });
}

/** Monta la capa de la página 0 dentro de un visor falso (para que Esc tenga adónde llevar el foco). */
function renderPage(scale = 1, pageIndex = 0) {
  return render(
    <>
      <div data-testid="viewer" tabIndex={0} />
      <FormLayer pageIndex={pageIndex} viewport={fakeViewport(scale)} />
    </>,
  );
}

beforeEach(() => {
  vi.mocked(setFieldValue).mockClear();
  setForms([...PAGE_ONE, otraPagina]);
  useAnnotations.setState(initialAnnotationState());
  useAppearance.setState({ nightMode: false });
});

afterEach(() => {
  useForms.setState({ fields: new Map(), byPage: new Map(), highlight: true });
});

describe('capa de formularios · controles de la página 1', () => {
  it('tiene un control por campo de texto, combo y lista con su nombre accesible', () => {
    renderPage();
    for (const name of ['nombre', 'comentarios', 'codigo', 'importe', 'persona.apellido', 'solo_lectura', 'Campo obligatorio', 'rotado']) {
      expect(screen.getByRole('textbox', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('combobox', { name: 'pais' })).toBeInTheDocument();
    expect(screen.getByRole('listbox', { name: 'idiomas' })).toBeInTheDocument();
  });

  it('no muestra los campos de otra página', () => {
    renderPage();
    expect(screen.queryByRole('textbox', { name: 'otra' })).not.toBeInTheDocument();
  });

  it('repite el campo nombre en cada página donde tiene un widget', () => {
    renderPage(1, 1);
    expect(screen.getByRole('textbox', { name: 'nombre' })).toHaveValue('Ana');
    expect(screen.getByRole('textbox', { name: 'otra' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'comentarios' })).not.toBeInTheDocument();
  });

  it('solo_lectura es readonly; codigo tiene maxlength 6; comentarios es un textarea; obligatorio, aria-required', () => {
    renderPage();
    expect(screen.getByRole('textbox', { name: 'solo_lectura' })).toHaveAttribute('readonly');
    expect(screen.getByRole('textbox', { name: 'codigo' })).toHaveAttribute('maxlength', '6');
    expect(screen.getByRole('textbox', { name: 'comentarios' }).tagName).toBe('TEXTAREA');
    expect(screen.getByRole('textbox', { name: 'Campo obligatorio' })).toHaveAttribute('aria-required', 'true');
  });
});

describe('capa de formularios · edición de texto', () => {
  it('escribir «Luis» en nombre y salir con Tab confirma una vez con ese texto', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByRole('textbox', { name: 'nombre' });
    await user.clear(input);
    await user.type(input, 'Luis');
    await user.tab();
    expect(setFieldValue).toHaveBeenCalledTimes(1);
    expect(setFieldValue).toHaveBeenCalledWith('nombre', { kind: 'text', text: 'Luis' });
  });

  it('escribir «X» y pulsar Esc no confirma y el campo vuelve a «Ana»; el foco pasa al visor', async () => {
    const user = userEvent.setup();
    renderPage();
    const input = screen.getByRole('textbox', { name: 'nombre' });
    await user.click(input);
    await user.type(input, 'X');
    await user.keyboard('{Escape}');
    expect(setFieldValue).not.toHaveBeenCalled();
    expect(input).toHaveValue('Ana');
    expect(screen.getByTestId('viewer')).toHaveFocus();
  });

  it('Intro en nombre confirma; Intro en comentarios añade un salto de línea sin confirmar', async () => {
    const user = userEvent.setup();
    renderPage();
    const nameInput = screen.getByRole('textbox', { name: 'nombre' });
    await user.clear(nameInput);
    await user.type(nameInput, 'Luis{Enter}');
    expect(setFieldValue).toHaveBeenCalledTimes(1);
    expect(setFieldValue).toHaveBeenLastCalledWith('nombre', { kind: 'text', text: 'Luis' });

    const area = screen.getByRole('textbox', { name: 'comentarios' });
    await user.click(area);
    await user.type(area, 'uno{Enter}dos');
    expect(area).toHaveValue('uno\ndos');
    expect(setFieldValue).toHaveBeenCalledTimes(1);
  });

  it('un campo sin cambios no confirma al salir', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('textbox', { name: 'nombre' }));
    await user.tab();
    expect(setFieldValue).not.toHaveBeenCalled();
  });
});

describe('capa de formularios · combos y listas', () => {
  it('elegir una opción del combo confirma su valor de exportación', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.selectOptions(screen.getByRole('combobox', { name: 'pais' }), 'pt');
    expect(setFieldValue).toHaveBeenCalledWith('pais', { kind: 'choice', selected: ['pt'] });
  });

  it('cambiar la selección de la lista confirma los valores elegidos', async () => {
    const user = userEvent.setup();
    renderPage();
    // La selección previa (es, en) sigue; elegir «fr» la añade: una sola confirmación con los tres valores.
    await user.selectOptions(screen.getByRole('listbox', { name: 'idiomas' }), ['fr']);
    expect(setFieldValue).toHaveBeenCalledTimes(1);
    expect(setFieldValue).toHaveBeenCalledWith('idiomas', { kind: 'choice', selected: ['es', 'en', 'fr'] });
  });

  it('muestra el valor efectivo: el del fichero si no hay cambios', () => {
    renderPage();
    expect(screen.getByRole('combobox', { name: 'pais' })).toHaveValue('es');
    expect(screen.getByRole('listbox', { name: 'idiomas' })).toHaveValue(['es', 'en']);
  });
});

describe('capa de formularios · puntero y resaltado', () => {
  it('con una herramienta de anotación activa, los controles no reciben el puntero', () => {
    useAnnotations.setState({ ...initialAnnotationState(), tool: 'highlight' });
    renderPage();
    expect(getComputedStyle(screen.getByRole('textbox', { name: 'nombre' })).pointerEvents).toBe('none');
    expect(getComputedStyle(screen.getByRole('combobox', { name: 'pais' })).pointerEvents).toBe('none');
  });

  it('sin herramienta de anotación, los controles sí reciben el puntero', () => {
    renderPage();
    expect(getComputedStyle(screen.getByRole('textbox', { name: 'nombre' })).pointerEvents).not.toBe('none');
  });

  it('los campos de solo lectura no llevan el resaltado de campos', () => {
    renderPage();
    // Con CSS Modules la clase lleva un sufijo de hash: se busca por su nombre base.
    expect(screen.getByRole('textbox', { name: 'nombre' }).className).toMatch(/highlight/);
    expect(screen.getByRole('textbox', { name: 'solo_lectura' }).className).not.toMatch(/highlight/);
  });
});

describe('capa de formularios · posición', () => {
  it('coloca cada control en la caja de su widget (escala 2)', () => {
    renderPage(2);
    const input = screen.getByRole('textbox', { name: 'nombre' });
    // rect [72, 760, 300, 780] con la página de 792 pt: x 72·2=144, y (792-780)·2=24, ancho 228·2, alto 20·2.
    expect(input.style.left).toBe('144px');
    expect(input.style.top).toBe('24px');
    expect(input.style.width).toBe('456px');
    expect(input.style.height).toBe('40px');
  });
});
