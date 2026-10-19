import type { VoiceInfo } from '../core/read-aloud/voices';

/** Motor de voz del sistema. La lectura pasa por aquí para poder probarla con una voz falsa. */
export interface SpeechPort {
  /** `true` si el navegador tiene la API de síntesis de voz. */
  available(): boolean;
  /** Voces instaladas. Si la lista llega vacía, espera a `voiceschanged` hasta 1 500 ms. */
  voices(): Promise<readonly VoiceInfo[]>;
  /** Dice `text` con la voz `voiceId` (solo voces locales). Llama a `onEnd` al acabar o a `onError` si falla. */
  speak(text: string, o: SpeakOptions): void;
  /** Para lo que se está diciendo. */
  cancel(): void;
}

export interface SpeakOptions {
  readonly voiceId: string;
  readonly rate: number;
  readonly lang: string;
  readonly onEnd: () => void;
  readonly onError: (reason: string) => void;
}

/** Tiempo máximo que se espera a que el navegador entregue la lista de voces. */
const VOICES_WAIT_MS = 1_500;

/** Port sobre `window.speechSynthesis`. Nunca usa voces que no sean locales. */
export function browserSpeechPort(): SpeechPort {
  return {
    available() {
      return typeof window !== 'undefined' && 'speechSynthesis' in window;
    },

    async voices() {
      const synth = window.speechSynthesis;
      let list = synth.getVoices();
      if (list.length === 0) list = await waitForVoices(synth, VOICES_WAIT_MS);
      return list.map((v) => ({ id: v.voiceURI, name: v.name, lang: v.lang, local: v.localService }));
    },

    speak(text, o) {
      const synth = window.speechSynthesis;
      const voice = synth.getVoices().find((v) => v.voiceURI === o.voiceId && v.localService);
      if (voice === undefined) {
        o.onError('voice-unavailable');
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.voice = voice;
      utterance.lang = o.lang;
      utterance.rate = o.rate;
      utterance.onend = () => { o.onEnd(); };
      utterance.onerror = (event: SpeechSynthesisErrorEvent) => { o.onError(event.error); };
      synth.speak(utterance);
    },

    cancel() {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
    },
  };
}

/** Espera a `voiceschanged` o hasta `ms` (lo que antes ocurra) y devuelve lo que haya en ese momento. */
function waitForVoices(synth: SpeechSynthesis, ms: number): Promise<SpeechSynthesisVoice[]> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      synth.removeEventListener('voiceschanged', done);
      resolve(synth.getVoices());
    };
    const timer = setTimeout(done, ms);
    synth.addEventListener('voiceschanged', done);
  });
}

let installed: SpeechPort | null = null;

/** Port instalado: por defecto el del navegador, creado al primer uso. */
export function speechPort(): SpeechPort {
  installed ??= browserSpeechPort();
  return installed;
}

/** Instala otro port (para tests). `null` vuelve al del navegador. */
export function setSpeechPort(p: SpeechPort | null): void {
  installed = p;
}
