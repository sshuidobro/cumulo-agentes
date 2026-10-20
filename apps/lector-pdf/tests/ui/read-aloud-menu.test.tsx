// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { VoiceInfo } from '../../src/core/read-aloud/voices';
import { setSpeechPort, type SpeechPort } from '../../src/state/speech-port';
import { useReadAloud } from '../../src/state/read-aloud-actions';
import { initServices } from '../../src/state/services';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { ViewMenu } from '../../src/ui/toolbar/ViewMenu';
import { readAloudMsg } from '../../src/ui/messages-read-aloud';
import { createFakePlatform } from '../helpers/fake-platform';

/** Puerto de voz con las voces dadas. */
function portWith(voices: readonly VoiceInfo[]): SpeechPort {
  return {
    available: () => true,
    voices: () => Promise.resolve(voices),
    speak: () => undefined,
    cancel: () => undefined,
  };
}

beforeEach(() => {
  initServices({ platform: createFakePlatform(), assetBaseUrl: 'http://localhost/pdfjs/' });
  useViewer.setState({ ...initialViewerState, status: 'ready' });
  useReadAloud.setState({ status: 'idle', scope: null, current: null, voices: [], voiceId: null, unavailable: false });
});

afterEach(() => {
  setSpeechPort(null);
});

describe('menú «Vista»: leer en voz alta', () => {
  it('sin voces locales, las dos entradas se ven deshabilitadas con la explicación', async () => {
    const user = userEvent.setup();
    setSpeechPort(portWith([{ id: 'google', name: 'Google español', lang: 'es-ES', local: false }]));
    render(<ViewMenu />);

    await user.click(screen.getByRole('button', { name: 'Vista' }));

    const page = screen.getByRole('menuitem', { name: readAloudMsg.readPage });
    const end = screen.getByRole('menuitem', { name: readAloudMsg.readToEnd });
    await waitFor(() => {
      expect(page).toBeDisabled();
    });
    expect(end).toBeDisabled();
    expect(page).toHaveAttribute('title', readAloudMsg.noVoices);
    expect(useReadAloud.getState().unavailable).toBe(true);
  });

  it('con una voz local, las entradas están habilitadas y muestran su atajo', async () => {
    const user = userEvent.setup();
    setSpeechPort(portWith([{ id: 'es-local', name: 'Helena', lang: 'es-ES', local: true }]));
    render(<ViewMenu />);

    await user.click(screen.getByRole('button', { name: 'Vista' }));

    await waitFor(() => {
      expect(useReadAloud.getState().voiceId).toBe('es-local');
    });
    const page = screen.getByRole('menuitem', { name: readAloudMsg.readPage });
    expect(page).toBeEnabled();
    expect(page).toHaveTextContent('Ctrl+Mayús+V');
    expect(screen.getByRole('menuitem', { name: readAloudMsg.readToEnd })).toBeEnabled();
  });
});
