// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../../src/ui/App';
import { addAnnotations, endAnnotationSession } from '../../src/state/annotation-actions';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { newAnnotation } from '../unit/annotations/factories';
import { createFakePlatform } from '../helpers/fake-platform';

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState({ ...initialViewerState, status: 'ready' });
});

afterEach(() => {
  endAnnotationSession();
  useAnnotations.setState(initialAnnotationState());
  useViewer.setState(initialViewerState);
});

describe('barra principal · deshacer', () => {
  it('«Deshacer» está deshabilitado sin cambios y, tras añadir un resaltado, lo deshace al pulsarlo', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('button', { name: 'Deshacer' })).toBeDisabled();

    act(() => {
      addAnnotations('añadir resaltado', [newAnnotation('suite-h1', 'highlight')]);
    });
    const undo = screen.getByRole('button', { name: 'Deshacer añadir resaltado' });
    expect(undo).toBeEnabled();
    expect(undo).toHaveAttribute('title', 'Deshacer añadir resaltado (Ctrl+Z)');

    await user.click(undo);
    expect(useAnnotations.getState().edits.upserts.size).toBe(0);
    expect(useAnnotations.getState().undo.canUndo).toBe(false);
    expect(screen.getByRole('button', { name: 'Rehacer añadir resaltado' })).toBeEnabled();
  });

  it('«Deshacer» está deshabilitado sin documento abierto aunque haya cambios', () => {
    useViewer.setState({ ...initialViewerState, status: 'empty' });
    act(() => {
      addAnnotations('añadir resaltado', [newAnnotation('suite-h1', 'highlight')]);
    });
    render(<App />);
    expect(screen.getByRole('button', { name: 'Deshacer añadir resaltado' })).toBeDisabled();
  });
});
