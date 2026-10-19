import { create, type StoreApi, type UseBoundStore } from 'zustand';
import { createLogger } from '@suite/shared';
import { pageChunks, type SpeechChunk } from '../core/read-aloud/chunks';
import { localVoices, pickVoice, READ_ALOUD_RATES, type VoiceInfo } from '../core/read-aloud/voices';
import type { PageTextSource } from '../core/search/session';
import { createPageTextSource } from '../engine/search-source';
import { readAloudMsg } from '../ui/messages-read-aloud';
import { goToPage } from './navigation';
import { showNotice } from './notice';
import { services } from './services';
import { speechPort } from './speech-port';
import { useViewer } from './viewer-store';

const log = createLogger('read-aloud');

export type ReadAloudStatus = 'idle' | 'loading' | 'speaking' | 'paused';
export type ReadRate = (typeof READ_ALOUD_RATES)[number];

export interface ReadAloudState {
  readonly status: ReadAloudStatus;
  readonly scope: 'page' | 'document' | null;
  /** Fragmento que se está diciendo (o el pausado). */
  readonly current: SpeechChunk | null;
  readonly rate: ReadRate;
  readonly voiceId: string | null;
  /** Voces locales, ya ordenadas. */
  readonly voices: readonly VoiceInfo[];
  /** Sin API de voz o sin voces locales. */
  readonly unavailable: boolean;
}

const INITIAL_STATE: ReadAloudState = {
  status: 'idle',
  scope: null,
  current: null,
  rate: 1,
  voiceId: null,
  voices: [],
  unavailable: false,
};

export const useReadAloud: UseBoundStore<StoreApi<ReadAloudState>> = create<ReadAloudState>()(() => INITIAL_STATE);

/** Clave de la preferencia de lectura: velocidad y voz elegidas. */
export const READ_ALOUD_PREF = 'read-aloud';

interface ReadAloudPref {
  readonly rate: ReadRate;
  readonly voiceId: string | null;
}

/** Páginas con texto a partir de `from`: su número de página y sus fragmentos. */
interface Found {
  readonly page: number;
  readonly chunks: readonly SpeechChunk[];
}

/** Una lectura en curso. Solo existe una a la vez (`run`). */
interface Run {
  readonly scope: 'page' | 'document';
  readonly source: PageTextSource;
  readonly numPages: number;
  readonly controller: AbortController;
  /** Sube en cada fragmento que se dice y al pausar: los `onEnd`/`onError` de un fragmento viejo se ignoran. */
  seq: number;
  /** Fragmentos de la página en curso. */
  chunks: readonly SpeechChunk[];
  /** Fragmento que se está diciendo (o el pausado). */
  index: number;
  /** Búsqueda de la página siguiente (lectura adelantada), o `null` si no hay más que leer. */
  next: Promise<Found | null> | null;
}

let run: Run | null = null;

// Si cambia el documento o la pestaña, la lectura se para (también al cerrar el documento).
useViewer.subscribe((state, previous) => {
  if (state.file !== previous.file) stopReading();
});

/** Carga las voces locales y elige la guardada (o la mejor disponible). Marca `unavailable` si no hay ninguna. */
export async function loadVoices(): Promise<void> {
  const port = speechPort();
  if (!port.available()) {
    useReadAloud.setState({ voices: [], voiceId: null, unavailable: true });
    return;
  }
  const voices = localVoices(await port.voices());
  const pref = savedPref();
  const picked = pickVoice(voices, pref?.voiceId ?? null);
  useReadAloud.setState({
    voices,
    voiceId: picked?.id ?? null,
    unavailable: picked === null,
    rate: pref?.rate ?? useReadAloud.getState().rate,
  });
}

/**
 * Lee la página actual o el documento desde la página actual hasta el final. Para cualquier lectura anterior.
 * Devuelve `'unavailable'` si no hay voz (o si falla al empezar), `'empty'` si no hay texto que leer y `'started'`
 * si la lectura ha empezado (o la ha tomado otra llamada mientras esta cargaba las voces).
 */
export async function startReading(scope: 'page' | 'document'): Promise<'started' | 'unavailable' | 'empty'> {
  stopReading();
  const viewer = useViewer.getState();
  const doc = viewer.pdf;
  if (doc === null) {
    showNotice(readAloudMsg.noText);
    return 'empty';
  }

  const r: Run = {
    scope,
    source: createPageTextSource(doc.doc),
    numPages: doc.numPages,
    controller: new AbortController(),
    seq: 0,
    chunks: [],
    index: 0,
    next: null,
  };
  run = r;
  useReadAloud.setState({ status: 'loading', scope, current: null });

  try {
    if (useReadAloud.getState().voices.length === 0) await loadVoices();
    if (run !== r) return 'started';

    const voice = useReadAloud.getState();
    if (voice.unavailable || voice.voiceId === null) {
      endRun();
      showNotice(readAloudMsg.noVoices);
      return 'unavailable';
    }

    const first = await findFrom(r, viewer.currentPage);
    if (run !== r) return 'started';
    if (first === null) {
      endRun();
      showNotice(readAloudMsg.noText);
      return 'empty';
    }

    if (first.page !== viewer.currentPage) goToPage(first.page);
    r.chunks = first.chunks;
    r.index = 0;
    r.next = prefetchNext(r, first.page);
    speakCurrent(r);
    return 'started';
  } catch (cause: unknown) {
    fail(r, cause);
    return 'unavailable';
  }
}

/** Pausa si está diciendo; reanuda diciendo el mismo fragmento si está pausada. */
export function togglePause(): void {
  const r = run;
  if (r === null) return;
  const { status } = useReadAloud.getState();
  if (status === 'speaking') {
    r.seq += 1;
    speechPort().cancel();
    useReadAloud.setState({ status: 'paused' });
  } else if (status === 'paused') {
    speakCurrent(r);
  }
}

/** Para la lectura y olvida su posición. */
export function stopReading(): void {
  if (run === null) return;
  endRun();
  speechPort().cancel();
}

/** Guarda la velocidad. Si está diciendo, repite el fragmento actual con la nueva velocidad. */
export function setRate(rate: ReadRate): void {
  useReadAloud.setState({ rate });
  savePref();
  restartCurrent();
}

/** Guarda la voz (una de las locales cargadas). Si está diciendo, repite el fragmento actual con ella. */
export function setVoice(id: string): void {
  if (!useReadAloud.getState().voices.some((v) => v.id === id)) return;
  useReadAloud.setState({ voiceId: id });
  savePref();
  restartCurrent();
}

function restartCurrent(): void {
  const r = run;
  if (r === null || useReadAloud.getState().status !== 'speaking') return;
  r.seq += 1;
  speechPort().cancel();
  speakCurrent(r);
}

/** Dice el fragmento `r.index`. */
function speakCurrent(r: Run): void {
  const chunk = r.chunks[r.index];
  const { voiceId, rate, voices } = useReadAloud.getState();
  if (chunk === undefined || voiceId === null) {
    endRun();
    return;
  }
  const seq = ++r.seq;
  const lang = voices.find((v) => v.id === voiceId)?.lang ?? '';
  useReadAloud.setState({ status: 'speaking', current: chunk });
  speechPort().speak(chunk.text, {
    voiceId,
    rate,
    lang,
    onEnd: () => {
      if (run === r && r.seq === seq) onChunkEnd(r);
    },
    onError: (reason) => {
      if (run === r && r.seq === seq) onChunkError(r, reason);
    },
  });
}

function onChunkEnd(r: Run): void {
  r.index += 1;
  if (r.index < r.chunks.length) {
    speakCurrent(r);
    return;
  }
  void advancePage(r);
}

/** Pasa a la página siguiente (si la hay) y sigue leyendo; si no, termina la lectura. */
async function advancePage(r: Run): Promise<void> {
  if (r.next === null) {
    endRun();
    return;
  }
  try {
    const found = await r.next;
    if (run !== r) return;
    if (found === null) {
      endRun();
      return;
    }
    goToPage(found.page);
    r.chunks = found.chunks;
    r.index = 0;
    r.next = prefetchNext(r, found.page);
    if (useReadAloud.getState().status === 'speaking') {
      speakCurrent(r);
    } else {
      // Pausada mientras se buscaba la página: queda lista para reanudar.
      useReadAloud.setState({ current: found.chunks[0] ?? null });
    }
  } catch (cause: unknown) {
    fail(r, cause);
  }
}

function onChunkError(r: Run, reason: string): void {
  if (reason === 'interrupted' || reason === 'canceled') return;
  log.warn('error de voz', reason);
  endRun();
  showNotice(readAloudMsg.failed);
}

function fail(r: Run, cause: unknown): void {
  if (run !== r) return;
  log.warn('lectura', cause);
  endRun();
  showNotice(readAloudMsg.failed);
}

/** Busca la primera página con texto desde `from`. En `'page'` solo mira esa página. */
async function findFrom(r: Run, from: number): Promise<Found | null> {
  for (let page = from; page < r.numPages; page++) {
    const items = await r.source.getPageItems(page, r.controller.signal);
    const chunks = pageChunks(page, items);
    if (chunks.length > 0) return { page, chunks };
    if (r.scope === 'page') return null;
  }
  return null;
}

/** Empieza la búsqueda de la página siguiente con antelación (solo al leer el documento). */
function prefetchNext(r: Run, page: number): Promise<Found | null> | null {
  if (r.scope !== 'document' || page + 1 >= r.numPages) return null;
  const pending = findFrom(r, page + 1);
  // El error llega cuando se espera la búsqueda (advancePage); aquí solo se evita el rechazo sin manejar.
  void pending.catch(() => undefined);
  return pending;
}

function endRun(): void {
  run?.controller.abort();
  run = null;
  useReadAloud.setState({ status: 'idle', scope: null, current: null });
}

function savedPref(): ReadAloudPref | null {
  return services().platform.prefs.get(READ_ALOUD_PREF, isPref);
}

function savePref(): void {
  const { rate, voiceId } = useReadAloud.getState();
  services().platform.prefs.set(READ_ALOUD_PREF, { rate, voiceId });
}

function isPref(value: unknown): value is ReadAloudPref {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as { readonly rate?: unknown; readonly voiceId?: unknown };
  return READ_ALOUD_RATES.some((rate) => rate === v.rate) && (v.voiceId === null || typeof v.voiceId === 'string');
}
