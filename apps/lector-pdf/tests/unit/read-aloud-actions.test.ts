import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SearchSourceModule from '../../src/engine/search-source';
import type { PageTextSource } from '../../src/core/search/session';
import type { VoiceInfo } from '../../src/core/read-aloud/voices';
import { PageDimsTable } from '../../src/core/page-dims';
import { loadPdf, type LoadedPdf } from '../../src/engine/load';
import { initServices } from '../../src/state/services';
import { setSpeechPort, type SpeakOptions, type SpeechPort } from '../../src/state/speech-port';
import {
  loadVoices,
  READ_ALOUD_PREF,
  setRate,
  setVoice,
  startReading,
  stopReading,
  togglePause,
  useReadAloud,
} from '../../src/state/read-aloud-actions';
import { initialViewerState, useViewer } from '../../src/state/viewer-store';
import { readAloudMsg } from '../../src/ui/messages-read-aloud';
import { createFakePlatform, openedFile } from '../helpers/fake-platform';
import { fixtureSource, nodeAssetBase } from '../helpers/pdfjs-node';

// Fuente de texto controlable: los tests que necesitan páginas vacías o errores la fijan aquí.
const override = vi.hoisted(() => ({ source: null as PageTextSource | null }));

vi.mock('../../src/engine/search-source', async (importOriginal) => {
  const actual = await importOriginal<typeof SearchSourceModule>();
  return {
    ...actual,
    createPageTextSource: (doc: Parameters<typeof actual.createPageTextSource>[0]) =>
      override.source ?? actual.createPageTextSource(doc),
  };
});

interface Spoken {
  readonly text: string;
  readonly opts: SpeakOptions;
}

/** Voz falsa: registra cada `speak` y `cancel`; los `onEnd` se disparan a mano. */
function fakePort(voices: readonly VoiceInfo[], available = true) {
  const spoken: Spoken[] = [];
  let cancels = 0;
  const port: SpeechPort = {
    available: () => available,
    voices: () => Promise.resolve(voices),
    speak: (text, opts) => {
      spoken.push({ text, opts });
    },
    cancel: () => {
      cancels += 1;
    },
  };
  return {
    port,
    spoken,
    cancels: () => cancels,
    at(index: number): Spoken {
      const item = spoken[index];
      if (item === undefined) throw new Error(`No se ha dicho el fragmento ${index}`);
      return item;
    },
  };
}

const VOICES: readonly VoiceInfo[] = [
  { id: 'google-es', name: 'Google español', lang: 'es-ES', local: false },
  { id: 'helena', name: 'Microsoft Helena', lang: 'es-ES', local: true },
  { id: 'alex', name: 'Alex', lang: 'en-US', local: true },
];

const REMOTE_ONLY: readonly VoiceInfo[] = VOICES.filter((v) => !v.local);

const initialReadAloud = useReadAloud.getState();
const assetBaseUrl = nodeAssetBase();
let loaded: LoadedPdf;

beforeAll(async () => {
  const result = await loadPdf(fixtureSource('basic-5.pdf'), { assetBaseUrl });
  if (!result.ok) throw new Error(`No se pudo abrir basic-5.pdf: ${result.error.code}`);
  loaded = result.value;
});

afterAll(async () => {
  await loaded.destroy();
});

/** Espera a que se cumpla `condition` (la lectura avanza con promesas). */
async function settle(condition: () => void): Promise<void> {
  await vi.waitFor(condition, { timeout: 5_000 });
}

function openBasic5(currentPage = 0): void {
  useViewer.setState({
    ...initialViewerState,
    status: 'ready',
    pdf: loaded,
    file: openedFile('basic-5.pdf', fixtureSource('basic-5.pdf')),
    dims: PageDimsTable.uniform(5, 612, 792, 0),
    currentPage,
  });
}

let port: ReturnType<typeof fakePort>;
let prefs: Map<string, unknown>;

beforeEach(() => {
  prefs = new Map();
  initServices({
    platform: createFakePlatform({
      prefs: {
        get: (key, guard) => {
          const value = prefs.get(key);
          return guard(value) ? value : null;
        },
        set: (key, value) => {
          prefs.set(key, value);
        },
        remove: (key) => {
          prefs.delete(key);
        },
      },
    }),
    assetBaseUrl,
  });
  port = fakePort(VOICES);
  setSpeechPort(port.port);
  openBasic5(0);
  override.source = null;
});

afterEach(() => {
  stopReading();
  setSpeechPort(null);
  useReadAloud.setState(initialReadAloud);
  useViewer.setState({ ...initialViewerState });
});

describe('loadVoices', () => {
  it('carga solo voces locales, elige la mejor y marca disponible', async () => {
    await loadVoices();
    const state = useReadAloud.getState();
    expect(state.voices.map((v) => v.id)).toEqual(['helena', 'alex']);
    expect(state.voiceId).toBe('helena');
    expect(state.unavailable).toBe(false);
  });

  it('sin API de voz queda no disponible', async () => {
    setSpeechPort(fakePort(VOICES, false).port);
    await loadVoices();
    expect(useReadAloud.getState()).toMatchObject({ voices: [], voiceId: null, unavailable: true });
  });

  it('sin voces locales queda no disponible', async () => {
    setSpeechPort(fakePort(REMOTE_ONLY).port);
    await loadVoices();
    expect(useReadAloud.getState()).toMatchObject({ voiceId: null, unavailable: true });
  });
});

describe('startReading', () => {
  it('lee la página: primer fragmento con la voz local española y la velocidad guardada', async () => {
    useReadAloud.setState({ rate: 1.25 });
    const result = await startReading('page');
    expect(result).toBe('started');
    expect(port.spoken).toHaveLength(1);
    expect(port.at(0).text).toBe('Página 1 de 5 marcador-1 El veloz murciélago hindú comía feliz cardillo y kiwi.');
    expect(port.at(0).opts).toMatchObject({ voiceId: 'helena', lang: 'es-ES', rate: 1.25 });
    expect(useReadAloud.getState()).toMatchObject({ status: 'speaking', scope: 'page' });
    expect(useReadAloud.getState().current?.pageIndex).toBe(0);
  });

  it('al terminar la única página vuelve a idle sin leer más', async () => {
    await startReading('page');
    port.at(0).opts.onEnd();
    expect(useReadAloud.getState()).toMatchObject({ status: 'idle', scope: null, current: null });
    expect(port.spoken).toHaveLength(1);
  });

  it('con la lectura de documento, al acabar una página dice la siguiente', async () => {
    await startReading('document');
    port.at(0).opts.onEnd();
    await settle(() => { expect(port.spoken).toHaveLength(2); });
    expect(port.at(1).text).toContain('Página 2 de 5');
    expect(useReadAloud.getState()).toMatchObject({ status: 'speaking', scope: 'document' });
  });

  it('desde la página 4 lee la 4 y la 5, va a la 5 al empezarla y termina en idle', async () => {
    openBasic5(3);
    expect(await startReading('document')).toBe('started');
    expect(port.at(0).text).toContain('Página 4 de 5');
    expect(useReadAloud.getState().current?.pageIndex).toBe(3);

    port.at(0).opts.onEnd();
    await settle(() => { expect(port.spoken).toHaveLength(2); });
    expect(port.at(1).text).toContain('Página 5 de 5');
    expect(useViewer.getState().navRequest?.page).toBe(4);
    expect(useReadAloud.getState().current?.pageIndex).toBe(4);

    port.at(1).opts.onEnd();
    await settle(() => { expect(useReadAloud.getState().status).toBe('idle'); });
    expect(port.spoken).toHaveLength(2);
    expect(useReadAloud.getState().scope).toBeNull();
  });

  it("sin voces locales: aviso, 'unavailable' y speak nunca llamado", async () => {
    setSpeechPort(fakePort(REMOTE_ONLY).port);
    const result = await startReading('page');
    expect(result).toBe('unavailable');
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.noVoices);
    expect(useReadAloud.getState().status).toBe('idle');
  });

  it("sin API de voz: aviso, 'unavailable' y speak nunca llamado", async () => {
    const silent = fakePort(VOICES, false);
    setSpeechPort(silent.port);
    expect(await startReading('document')).toBe('unavailable');
    expect(silent.spoken).toHaveLength(0);
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.noVoices);
  });

  it('una página sin texto da aviso y \'empty\' al leer la página', async () => {
    override.source = { getPageItems: () => Promise.resolve([]) };
    expect(await startReading('page')).toBe('empty');
    expect(port.spoken).toHaveLength(0);
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.noText);
    expect(useReadAloud.getState().status).toBe('idle');
  });

  it('al leer el documento salta las páginas sin texto', async () => {
    override.source = {
      getPageItems: (pageIndex) => Promise.resolve(pageIndex === 2 ? [{ str: 'Solo esta.', hasEOL: false }] : []),
    };
    expect(await startReading('document')).toBe('started');
    expect(port.at(0).text).toBe('Solo esta.');
    expect(useViewer.getState().navRequest?.page).toBe(2);
  });

  it('sin documento abierto no lee y da aviso', async () => {
    useViewer.setState({ pdf: null });
    expect(await startReading('page')).toBe('empty');
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.noText);
  });

  it('un error al leer el texto da aviso y para', async () => {
    override.source = { getPageItems: () => Promise.reject(new Error('disco')) };
    expect(await startReading('page')).toBe('unavailable');
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.failed);
    expect(useReadAloud.getState().status).toBe('idle');
  });

  it('una nueva lectura sustituye a la anterior', async () => {
    await startReading('page');
    await startReading('document');
    expect(port.cancels()).toBeGreaterThan(0);
    expect(useReadAloud.getState()).toMatchObject({ status: 'speaking', scope: 'document' });
    port.at(0).opts.onEnd();
    expect(port.spoken).toHaveLength(2);
    port.at(1).opts.onEnd();
    await settle(() => { expect(port.spoken).toHaveLength(3); });
  });
});

describe('pausa y reanudación', () => {
  it('pausar cancela; reanudar dice el mismo fragmento; un onEnd tardío no avanza', async () => {
    await startReading('document');
    const first = port.at(0);

    togglePause();
    expect(port.cancels()).toBeGreaterThan(0);
    expect(useReadAloud.getState().status).toBe('paused');

    first.opts.onEnd();
    expect(port.spoken).toHaveLength(1);
    expect(useReadAloud.getState().status).toBe('paused');

    togglePause();
    expect(port.spoken).toHaveLength(2);
    expect(port.at(1).text).toBe(first.text);
    expect(useReadAloud.getState().status).toBe('speaking');
  });

  it('un error de voz por cancelación se ignora', async () => {
    await startReading('page');
    port.at(0).opts.onError('interrupted');
    expect(useReadAloud.getState().status).toBe('speaking');
    port.at(0).opts.onError('canceled');
    expect(useReadAloud.getState().status).toBe('speaking');
  });

  it('pausar sin lectura no hace nada', () => {
    togglePause();
    expect(useReadAloud.getState().status).toBe('idle');
  });

  it('pausar y reanudar mientras se busca la página siguiente no dice nada dos veces', async () => {
    const gate: { release?: (items: { str: string; hasEOL: boolean }[]) => void } = {};
    override.source = {
      getPageItems: (pageIndex) =>
        pageIndex === 0
          ? Promise.resolve([{ str: 'Primera.', hasEOL: false }])
          : pageIndex === 1
            ? new Promise((resolve) => { gate.release = resolve; })
            : Promise.resolve([]),
    };
    await startReading('document');
    port.at(0).opts.onEnd();

    togglePause();
    togglePause();
    expect(port.spoken).toHaveLength(1);
    expect(useReadAloud.getState().status).toBe('speaking');

    gate.release?.([{ str: 'Segunda.', hasEOL: false }]);
    await settle(() => { expect(port.spoken).toHaveLength(2); });
    expect(port.at(1).text).toBe('Segunda.');
    expect(useViewer.getState().navRequest?.page).toBe(1);
    expect(useReadAloud.getState().status).toBe('speaking');
  });

  it('pausar mientras se busca la página siguiente y reanudar después la deja lista', async () => {
    const gate: { release?: (items: { str: string; hasEOL: boolean }[]) => void } = {};
    override.source = {
      getPageItems: (pageIndex) =>
        pageIndex === 0
          ? Promise.resolve([{ str: 'Primera.', hasEOL: false }])
          : pageIndex === 1
            ? new Promise((resolve) => { gate.release = resolve; })
            : Promise.resolve([]),
    };
    await startReading('document');
    port.at(0).opts.onEnd();

    togglePause();
    gate.release?.([{ str: 'Segunda.', hasEOL: false }]);
    await settle(() => { expect(useReadAloud.getState().current?.text).toBe('Segunda.'); });
    expect(port.spoken).toHaveLength(1);
    expect(useReadAloud.getState().status).toBe('paused');

    togglePause();
    expect(port.spoken).toHaveLength(2);
    expect(port.at(1).text).toBe('Segunda.');
  });
});

describe('errores, parada y cambios de documento', () => {
  it('un error de voz real da aviso y para', async () => {
    await startReading('page');
    port.at(0).opts.onError('synthesis-failed');
    expect(useViewer.getState().notice?.text).toBe(readAloudMsg.failed);
    expect(useReadAloud.getState()).toMatchObject({ status: 'idle', current: null });
  });

  it('stopReading para la voz y vuelve a idle', async () => {
    await startReading('page');
    const before = port.cancels();
    stopReading();
    expect(port.cancels()).toBe(before + 1);
    expect(useReadAloud.getState().status).toBe('idle');
    port.at(0).opts.onEnd();
    expect(useReadAloud.getState().status).toBe('idle');
  });

  it('abrir otro documento durante la lectura cancela y deja idle', async () => {
    await startReading('document');
    useViewer.setState({ file: openedFile('otro.pdf', fixtureSource('basic-5.pdf')) });
    expect(port.cancels()).toBeGreaterThan(0);
    expect(useReadAloud.getState()).toMatchObject({ status: 'idle', scope: null });
  });

  it('cambiar la velocidad mientras se dice repite el fragmento con la nueva', async () => {
    await startReading('page');
    setRate(1.5);
    expect(port.spoken).toHaveLength(2);
    expect(port.at(1).text).toBe(port.at(0).text);
    expect(port.at(1).opts.rate).toBe(1.5);
    expect(prefs.get(READ_ALOUD_PREF)).toEqual({ rate: 1.5, voiceId: 'helena' });
  });

  it('cambiar la velocidad fuera de una lectura solo la guarda', () => {
    setRate(0.75);
    expect(useReadAloud.getState().rate).toBe(0.75);
    expect(port.spoken).toHaveLength(0);
  });

  it('cambiar la voz guarda la elegida y repite el fragmento; una voz desconocida se ignora', async () => {
    await loadVoices();
    await startReading('page');
    setVoice('alex');
    expect(port.at(1).opts.voiceId).toBe('alex');
    expect(port.at(1).opts.lang).toBe('en-US');
    setVoice('no-existe');
    expect(useReadAloud.getState().voiceId).toBe('alex');
  });

  it('la velocidad y la voz guardadas se usan al cargar las voces', async () => {
    prefs.set(READ_ALOUD_PREF, { rate: 2, voiceId: 'alex' });
    await loadVoices();
    expect(useReadAloud.getState()).toMatchObject({ rate: 2, voiceId: 'alex' });
  });
});
