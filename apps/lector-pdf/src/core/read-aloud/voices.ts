/** Voz del sistema para leer en voz alta. `id` es el `voiceURI` de la voz. */
export interface VoiceInfo {
  readonly id: string;
  readonly name: string;
  readonly lang: string;
  /** `true` si la voz la sintetiza el propio equipo (sin enviar el texto a ningún servicio). */
  readonly local: boolean;
}

/** Velocidades de lectura que ofrece la app (factor sobre la velocidad normal). */
export const READ_ALOUD_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Elige la voz a usar entre las locales: la de `preferredId` si existe; si no, la primera `es-ES`;
 * si no, la primera `es-*` (sin distinguir mayúsculas y con `es_ES` también); si no, la primera local; ninguna → `null`.
 */
export function pickVoice(voices: readonly VoiceInfo[], preferredId: string | null): VoiceInfo | null {
  const local = localVoices(voices);
  if (preferredId !== null) {
    const preferred = local.find((v) => v.id === preferredId);
    if (preferred !== undefined) return preferred;
  }
  const spanishSpain = local.find((v) => normalizeLang(v.lang) === 'es-es');
  if (spanishSpain !== undefined) return spanishSpain;
  const spanish = local.find((v) => isSpanish(v.lang));
  if (spanish !== undefined) return spanish;
  return local[0] ?? null;
}

/** Voces locales ordenadas: españolas primero, luego por nombre (`localeCompare('es')`). */
export function localVoices(voices: readonly VoiceInfo[]): readonly VoiceInfo[] {
  return voices
    .filter((v) => v.local)
    .slice()
    .sort((a, b) => {
      const rank = Number(!isSpanish(a.lang)) - Number(!isSpanish(b.lang));
      return rank !== 0 ? rank : a.name.localeCompare(b.name, 'es');
    });
}

function normalizeLang(lang: string): string {
  return lang.replace('_', '-').toLowerCase();
}

function isSpanish(lang: string): boolean {
  return /^es(-|_|$)/iu.test(lang);
}
