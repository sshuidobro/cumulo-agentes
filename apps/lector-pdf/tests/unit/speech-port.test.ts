import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserSpeechPort } from '../../src/state/speech-port';

interface FakeVoice {
  readonly voiceURI: string;
  readonly name: string;
  readonly lang: string;
  readonly localService: boolean;
}

class FakeUtterance {
  voice: FakeVoice | null = null;
  lang = '';
  rate = 1;
  onend: (() => void) | null = null;
  onerror: ((event: { readonly error: string }) => void) | null = null;
  constructor(readonly text: string) {}
}

/** `speechSynthesis` falso: lista de voces editable, registra `speak` y `cancel`, y emite `voiceschanged`. */
function fakeSynth(initial: readonly FakeVoice[]) {
  let voices: readonly FakeVoice[] = initial;
  const spoken: FakeUtterance[] = [];
  const listeners = new Set<() => void>();
  let cancels = 0;
  return {
    spoken,
    cancels: () => cancels,
    getVoices: () => voices,
    speak: (utterance: FakeUtterance) => {
      spoken.push(utterance);
    },
    cancel: () => {
      cancels += 1;
    },
    addEventListener: (_type: string, listener: () => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: () => void) => {
      listeners.delete(listener);
    },
    listeners: () => listeners.size,
    setVoices(next: readonly FakeVoice[]) {
      voices = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const LOCAL_ES: FakeVoice = { voiceURI: 'helena', name: 'Microsoft Helena', lang: 'es-ES', localService: true };
const REMOTE_ES: FakeVoice = { voiceURI: 'google-es', name: 'Google español', lang: 'es-ES', localService: false };

function installSynth(voices: readonly FakeVoice[]) {
  const synth = fakeSynth(voices);
  vi.stubGlobal('window', { speechSynthesis: synth });
  vi.stubGlobal('SpeechSynthesisUtterance', FakeUtterance);
  return synth;
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browserSpeechPort · disponibilidad', () => {
  it('sin API de síntesis no está disponible y cancelar no lanza', () => {
    vi.stubGlobal('window', {});
    const port = browserSpeechPort();
    expect(port.available()).toBe(false);
    expect(() => { port.cancel(); }).not.toThrow();
  });

  it('con la API de síntesis está disponible y cancelar la llama', () => {
    const synth = installSynth([LOCAL_ES]);
    const port = browserSpeechPort();
    expect(port.available()).toBe(true);
    port.cancel();
    expect(synth.cancels()).toBe(1);
  });
});

describe('browserSpeechPort · voces', () => {
  it('devuelve las voces del sistema con id = voiceURI y el indicador de local', async () => {
    installSynth([LOCAL_ES, REMOTE_ES]);
    await expect(browserSpeechPort().voices()).resolves.toEqual([
      { id: 'helena', name: 'Microsoft Helena', lang: 'es-ES', local: true },
      { id: 'google-es', name: 'Google español', lang: 'es-ES', local: false },
    ]);
  });

  it('si la lista llega vacía, espera a voiceschanged y devuelve las voces que lleguen', async () => {
    const synth = installSynth([]);
    const pending = browserSpeechPort().voices();
    synth.setVoices([LOCAL_ES]);
    await expect(pending).resolves.toEqual([{ id: 'helena', name: 'Microsoft Helena', lang: 'es-ES', local: true }]);
    expect(synth.listeners()).toBe(0);
  });

  it('si no llega voiceschanged, termina a los 1 500 ms con la lista vacía', async () => {
    vi.useFakeTimers();
    const synth = installSynth([]);
    const pending = browserSpeechPort().voices();
    await vi.advanceTimersByTimeAsync(1_499);
    expect(synth.listeners()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual([]);
    expect(synth.listeners()).toBe(0);
  });

  it('si ya hay voces no espera', async () => {
    const synth = installSynth([LOCAL_ES]);
    vi.useFakeTimers();
    await expect(browserSpeechPort().voices()).resolves.toHaveLength(1);
    expect(synth.listeners()).toBe(0);
  });
});

describe('browserSpeechPort · hablar', () => {
  it('con una voz local fija voz, idioma, velocidad y texto, y propaga el fin', () => {
    const synth = installSynth([LOCAL_ES]);
    const onEnd = vi.fn();
    const onError = vi.fn();
    browserSpeechPort().speak('Hola mundo.', { voiceId: 'helena', rate: 1.25, lang: 'es-ES', onEnd, onError });

    expect(synth.spoken).toHaveLength(1);
    const utterance = synth.spoken[0];
    expect(utterance?.text).toBe('Hola mundo.');
    expect(utterance?.voice).toBe(LOCAL_ES);
    expect(utterance?.lang).toBe('es-ES');
    expect(utterance?.rate).toBe(1.25);

    utterance?.onend?.();
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it('propaga el error de síntesis con su motivo', () => {
    const synth = installSynth([LOCAL_ES]);
    const onError = vi.fn();
    browserSpeechPort().speak('Hola.', { voiceId: 'helena', rate: 1, lang: 'es-ES', onEnd: vi.fn(), onError });
    synth.spoken[0]?.onerror?.({ error: 'synthesis-failed' });
    expect(onError).toHaveBeenCalledWith('synthesis-failed');
  });

  it('nunca usa una voz no local: avisa y no habla', () => {
    const synth = installSynth([REMOTE_ES]);
    const onEnd = vi.fn();
    const onError = vi.fn();
    browserSpeechPort().speak('Hola.', { voiceId: 'google-es', rate: 1, lang: 'es-ES', onEnd, onError });
    expect(onError).toHaveBeenCalledWith('voice-unavailable');
    expect(synth.spoken).toHaveLength(0);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it('una voz que no existe avisa y no habla', () => {
    const synth = installSynth([LOCAL_ES]);
    const onError = vi.fn();
    browserSpeechPort().speak('Hola.', { voiceId: 'desconocida', rate: 1, lang: 'es-ES', onEnd: vi.fn(), onError });
    expect(onError).toHaveBeenCalledWith('voice-unavailable');
    expect(synth.spoken).toHaveLength(0);
  });
});
