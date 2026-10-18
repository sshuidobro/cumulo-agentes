// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { memorySource } from '@suite/platform';
import { PageDimsTable } from '../../src/core/page-dims';
import { Viewer } from '../../src/ui/viewer/Viewer';
import { initialAnnotationState, useAnnotations } from '../../src/state/annotation-store';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { openedFile } from '../helpers/fake-platform';

beforeEach(() => {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    file: openedFile('pages.pdf', memorySource(new Uint8Array([0x25]))),
    dims: PageDimsTable.uniform(3, 612, 792, 0),
    dimsVersion: 1,
  });
  useAnnotations.setState(initialAnnotationState());
});

afterEach(() => {
  useViewer.setState(initialViewerState);
  useAnnotations.setState(initialAnnotationState());
});

function dataTool(): string | undefined {
  return screen.getByTestId('viewer').dataset.tool;
}

describe('Viewer · cursor según la herramienta de anotación', () => {
  it('con una herramienta de anotación, el visor muestra esa herramienta en data-tool', () => {
    useAnnotations.setState({ tool: 'ink' });
    render(<Viewer />);
    expect(dataTool()).toBe('ink');
  });

  it('sin herramienta de anotación, data-tool sigue la herramienta de vista (selección o mano)', () => {
    useViewer.setState({ tool: 'hand' });
    render(<Viewer />);
    expect(dataTool()).toBe('hand');
  });
});
