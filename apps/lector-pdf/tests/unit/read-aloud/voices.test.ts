import { describe, expect, it } from 'vitest';
import { localVoices, pickVoice, READ_ALOUD_RATES, type VoiceInfo } from '../../../src/core/read-aloud/voices';

const GOOGLE_ES: VoiceInfo = { id: 'google-es', name: 'Google español', lang: 'es-ES', local: false };
const HELENA: VoiceInfo = { id: 'helena', name: 'Microsoft Helena', lang: 'es-ES', local: true };
const ALEX: VoiceInfo = { id: 'alex', name: 'Alex', lang: 'en-US', local: true };

describe('pickVoice', () => {
  it('elige la española local aunque haya una remota (Google español)', () => {
    expect(pickVoice([GOOGLE_ES, HELENA, ALEX], null)?.id).toBe('helena');
  });

  it('respeta la voz guardada si es local', () => {
    expect(pickVoice([GOOGLE_ES, HELENA, ALEX], 'alex')?.id).toBe('alex');
  });

  it('ignora la voz guardada si no es local y usa la predeterminada', () => {
    expect(pickVoice([GOOGLE_ES, HELENA, ALEX], 'google-es')?.id).toBe('helena');
  });

  it('sin voces locales devuelve null', () => {
    expect(pickVoice([GOOGLE_ES], null)).toBeNull();
    expect(pickVoice([], 'helena')).toBeNull();
  });

  it('sin española local usa la primera local', () => {
    expect(pickVoice([ALEX], null)?.id).toBe('alex');
  });

  it('acepta códigos es_ES y es-MX; prefiere es-ES a es-*', () => {
    const mexico: VoiceInfo = { id: 'mx', name: 'Paulina', lang: 'es-MX', local: true };
    const spainUnderscore: VoiceInfo = { id: 'es_ES', name: 'Jorge', lang: 'es_ES', local: true };
    expect(pickVoice([mexico, ALEX], null)?.id).toBe('mx');
    expect(pickVoice([mexico, spainUnderscore], null)?.id).toBe('es_ES');
    expect(pickVoice([{ ...ALEX, lang: 'ES-es' }, mexico], null)?.id).toBe('alex');
  });

  it('una voz guardada ausente de la lista cuenta como no guardada', () => {
    expect(pickVoice([HELENA], 'no-existe')?.id).toBe('helena');
  });
});

describe('localVoices', () => {
  it('solo locales, españolas primero y luego por nombre', () => {
    const zeta: VoiceInfo = { id: 'z', name: 'Zeta', lang: 'es-MX', local: true };
    const jorge: VoiceInfo = { id: 'j', name: 'Jorge', lang: 'es-ES', local: true };
    const result = localVoices([ALEX, zeta, GOOGLE_ES, HELENA, jorge]);
    expect(result.map((v) => v.id)).toEqual(['j', 'helena', 'z', 'alex']);
  });

  it('no modifica la lista original', () => {
    const input = [ALEX, HELENA];
    localVoices(input);
    expect(input).toEqual([ALEX, HELENA]);
  });
});

describe('READ_ALOUD_RATES', () => {
  it('ofrece de 0,5 a 2 en los pasos del plan', () => {
    expect(READ_ALOUD_RATES).toEqual([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]);
  });
});
