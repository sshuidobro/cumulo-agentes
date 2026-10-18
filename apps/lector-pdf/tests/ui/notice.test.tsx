// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dismissNotice, showNotice } from '../../src/state/notice';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { Notice, NOTICE_MS } from '../../src/ui/kit/Notice';

beforeEach(() => {
  vi.useFakeTimers();
  useViewer.setState(initialViewerState);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Muestra el aviso del store, como lo haría la app. */
function Host() {
  const notice = useViewer((s) => s.notice);
  return <Notice notice={notice} onExpire={dismissNotice} />;
}

describe('Notice', () => {
  it('muestra el aviso como status y lo retira a los 4 s', () => {
    render(<Host />);
    act(() => { showNotice('El destino de este enlace no existe en el documento.'); });
    expect(screen.getByRole('status')).toHaveTextContent('El destino de este enlace no existe en el documento.');

    act(() => { vi.advanceTimersByTime(NOTICE_MS - 1); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('un aviso nuevo sustituye al anterior y reinicia el tiempo', () => {
    render(<Host />);
    act(() => { showNotice('primero'); });
    act(() => { vi.advanceTimersByTime(3000); });
    act(() => { showNotice('segundo'); });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getByRole('status')).toHaveTextContent('segundo');
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('dismissNotice con un id antiguo no retira el aviso vigente', () => {
    act(() => { showNotice('a'); });
    const first = useViewer.getState().notice?.id ?? -1;
    act(() => { showNotice('b'); });
    act(() => { dismissNotice(first); });
    expect(useViewer.getState().notice?.text).toBe('b');
  });
});
