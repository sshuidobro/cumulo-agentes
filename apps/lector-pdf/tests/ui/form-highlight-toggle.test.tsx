// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FormField } from '../../src/core/forms';
import { endAnnotationSession } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { useForms } from '../../src/state/form-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { MainToolbar } from '../../src/ui/toolbar/MainToolbar';
import { formMsg } from '../../src/ui/messages-forms';
import { createFakePlatform } from '../helpers/fake-platform';

const TEXT_FIELD: FormField = {
  name: 'nombre',
  type: 'text',
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
  initial: { kind: 'text', text: 'Ana' },
  widgets: [{ id: '1R', ref: { num: 1, gen: 0 }, pageIndex: 0, rect: [72, 760, 300, 780], onState: null, rotation: 0, background: null, border: null }],
};

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState({ ...initialViewerState, status: 'ready' });
  useForms.setState({ fields: new Map(), byPage: new Map(), highlight: true });
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
  useForms.setState({ fields: new Map(), byPage: new Map(), highlight: true });
});

describe('barra principal · resaltar campos', () => {
  it('no aparece sin campos de formulario', () => {
    render(<MainToolbar />);
    expect(screen.queryByRole('button', { name: formMsg.highlight })).not.toBeInTheDocument();
  });

  it('aparece con campos, pulsado por defecto, y alterna el resaltado al pulsarlo', async () => {
    const user = userEvent.setup();
    useForms.setState({ fields: new Map([[TEXT_FIELD.name, TEXT_FIELD]]), byPage: new Map([[0, ['nombre']]]) });
    render(<MainToolbar />);

    const button = screen.getByRole('button', { name: formMsg.highlight });
    expect(button).toHaveAttribute('aria-pressed', 'true');

    await user.click(button);
    expect(useForms.getState().highlight).toBe(false);
    expect(screen.getByRole('button', { name: formMsg.highlight })).toHaveAttribute('aria-pressed', 'false');
  });
});
