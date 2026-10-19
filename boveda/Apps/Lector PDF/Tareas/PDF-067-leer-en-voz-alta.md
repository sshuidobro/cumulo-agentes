---
tipo: tarea
id: PDF-067
titulo: Leer en voz alta - frases, voces y motor de lectura
app: pdf
estado: en-curso
depende_de: [PDF-022]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, accesibilidad]
---

# PDF-067 · Leer en voz alta: frases, voces y motor de lectura

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Decisiones: [[ADR-0033-leer-en-voz-alta]] · Paridad: [[Paridad Adobe Acrobat]] · Sigue: [[PDF-114-leer-en-voz-alta-interfaz]]

> 2026-10-19 (líder): se reparte en motor (esta ficha, sin interfaz) e interfaz ([[PDF-114-leer-en-voz-alta-interfaz]]).

## Objetivo
La app sabe leer la página actual o el documento hasta el final con una voz **local** del sistema, fragmento a fragmento, con pausa, reanudar, parar, velocidad y voz, y publica el fragmento en curso (con su posición en el texto) para que la interfaz lo resalte. Todo probado con una voz falsa.

## Contexto
- [[ADR-0033-leer-en-voz-alta]] (todas las viñetas de «Decisión»).
- `src/core/search/page-text.ts` → `TextItemLike`, `TextPos`, `buildPageText`, `rawOffsetToPos`.
- `src/engine/search-source.ts` → `createPageTextSource(doc)` (ítems de texto por página, con `AbortSignal`).
- `src/state/viewer-store.ts` (`pdf`, `file`, `currentPage`), `src/state/navigation.ts` → `goToPage`, `src/state/services.ts` (`platform.prefs`), `src/state/notice.ts` → `showNotice`.
- Patrón de store pequeño con acciones: `src/state/print-actions.ts` (`usePrintJob`).

## Qué hay que hacer
1. `src/core/read-aloud/chunks.ts` (puro):
```ts
export const MAX_CHUNK_CHARS = 200;
export interface SpeechChunk { readonly pageIndex: number; readonly text: string; readonly start: TextPos; readonly end: TextPos } // end exclusivo
/** Frases de la página con `Intl.Segmenter('es', { granularity: 'sentence' })` (si no existe: corte tras [.!?…] seguido de espacio). Sin espacios en los extremos; vacías fuera; `-\n` entre letras se elimina y `\n` → espacio en `text`; más de 200 caracteres → corte en el último espacio antes de 200 (o a 200 si no hay). */
export function pageChunks(pageIndex: number, items: readonly TextItemLike[]): readonly SpeechChunk[];
```
2. `src/core/read-aloud/voices.ts` (puro):
```ts
export interface VoiceInfo { readonly id: string; readonly name: string; readonly lang: string; readonly local: boolean } // id = voiceURI
/** Solo locales. Orden: la de `preferredId` si existe; si no, primera `es-ES`; si no, primera `es-*` (sin distinguir mayúsculas, `es_ES` también); si no, la primera local; ninguna → null. */
export function pickVoice(voices: readonly VoiceInfo[], preferredId: string | null): VoiceInfo | null;
/** Voces locales ordenadas: españolas primero, luego por nombre (`localeCompare('es')`). */
export function localVoices(voices: readonly VoiceInfo[]): readonly VoiceInfo[];
export const READ_ALOUD_RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;
```
3. `src/state/speech-port.ts`:
```ts
export interface SpeechPort {
  available(): boolean;                              // 'speechSynthesis' in window
  voices(): Promise<readonly VoiceInfo[]>;           // si getVoices() está vacío, espera 'voiceschanged' hasta 1 500 ms
  speak(text: string, o: { readonly voiceId: string; readonly rate: number; readonly lang: string; readonly onEnd: () => void; readonly onError: (reason: string) => void }): void;
  cancel(): void;
}
export function browserSpeechPort(): SpeechPort;     // envuelve window.speechSynthesis; voz por voiceURI; nunca usa voces no locales
export function speechPort(): SpeechPort;            // la instalada (por defecto browserSpeechPort, creada al primer uso)
export function setSpeechPort(p: SpeechPort | null): void; // tests
```
4. `src/state/read-aloud-actions.ts`:
```ts
export type ReadAloudStatus = 'idle' | 'loading' | 'speaking' | 'paused';
export interface ReadAloudState {
  readonly status: ReadAloudStatus;
  readonly scope: 'page' | 'document' | null;
  readonly current: SpeechChunk | null;   // fragmento que se está diciendo (o el pausado)
  readonly rate: (typeof READ_ALOUD_RATES)[number];
  readonly voiceId: string | null;
  readonly voices: readonly VoiceInfo[];  // locales, ya ordenadas
  readonly unavailable: boolean;          // sin API o sin voces locales
}
export const useReadAloud: UseBoundStore<StoreApi<ReadAloudState>>;
export const READ_ALOUD_PREF = 'read-aloud'; // { rate, voiceId }
export async function loadVoices(): Promise<void>;       // rellena voices, voiceId (pickVoice) y unavailable
export async function startReading(scope: 'page' | 'document'): Promise<'started' | 'unavailable' | 'empty'>;
export function togglePause(): void;                     // speaking → paused (cancel); paused → vuelve a decir `current`
export function stopReading(): void;
export function setRate(rate: ReadAloudState['rate']): void;  // guarda la preferencia; si está hablando, repite `current` con la nueva velocidad
export function setVoice(id: string): void;                   // igual que setRate
```
   - `startReading`: para cualquier lectura anterior; `loadVoices` si hace falta; `unavailable` → aviso `readAloudMsg.noVoices` («Tu sistema no tiene voces instaladas para leer en voz alta.») y `'unavailable'`. Empieza en `useViewer.currentPage`: lee los ítems con `createPageTextSource(pdf.doc)`, `pageChunks`; sin fragmentos y `scope === 'page'` → aviso «Esta página no tiene texto que leer.» y `'empty'`; con `scope === 'document'` salta a la siguiente con texto.
   - Cada fragmento: `current` = fragmento, `status: 'speaking'`, `speak(...)` con `lang` de la voz. Secuencia creciente por `speak`: `onEnd`/`onError` de una secuencia vieja se ignoran. Al acabar la página: `scope 'page'` → `idle`; `'document'` → siguiente página (la pide antes de terminar la actual: lectura adelantada de 1 página) y `goToPage(next)` al empezar su primer fragmento. Última página → `idle`.
   - `onError` con `interrupted`/`canceled` se ignora; otro → aviso «No se ha podido leer en voz alta.» y `idle`.
   - Se para (`stopReading`) cuando cambia `useViewer.file` (otro documento o pestaña) y al llamar a `closeDocument`.
   - Mientras lee no retiene más de 2 páginas de fragmentos en memoria.
   - Textos en `src/ui/messages-read-aloud.ts` (`readAloudMsg`): `noVoices`, `noText` «Esta página no tiene texto que leer.», `failed` «No se ha podido leer en voz alta.».
5. Tests: `tests/unit/read-aloud/chunks.test.ts`, `voices.test.ts`, `tests/unit/read-aloud-actions.test.ts` con un `SpeechPort` falso (registra `speak`, dispara `onEnd` a mano) y documentos reales (`basic-5.pdf`, pdf.js en Node).

## Criterios de aceptación
- [ ] `pageChunks` de la página 1 de `basic-5.pdf` → fragmentos «Página 1 de 5 marcador-1 El veloz murciélago hindú comía feliz cardillo y kiwi.» o la partición en frases que dé `Intl.Segmenter` (el test fija la salida real de Node 22), y cada `start`/`end` señala exactamente su texto en los ítems.
- [ ] Una frase de 450 caracteres → 3 fragmentos ≤ 200 cortados en espacios; «docu-\nmento» se lee «documento».
- [ ] `pickVoice`: con [Google español (red), Microsoft Helena es-ES (local), Alex en-US (local)] → Helena; sin locales → `null`; con `preferredId` de Alex → Alex.
- [ ] Unit: `startReading('page')` en `basic-5.pdf` llama a `speak` con el primer fragmento, voz local española y `rate` guardada; `onEnd` → siguiente; tras el último, `status: 'idle'`.
- [ ] Unit: `togglePause()` mientras habla → `cancel` y `paused`; otra vez → vuelve a decir el mismo fragmento; un `onEnd` tardío del enunciado cancelado no avanza (secuencia).
- [ ] Unit: `startReading('document')` desde la página 4 lee la 4 y la 5, llama a `goToPage(4)` al empezar la 5, y termina en `idle`.
- [ ] Unit: sin `speechSynthesis` o sin voces locales → `'unavailable'` con su aviso y `speak` nunca llamado (privacidad: test que pasa solo voces `local: false`).
- [ ] Unit: abrir otro documento durante la lectura → `cancel` y `idle`.
- [ ] Cobertura de `src/core/read-aloud/` ≥ 95 % y de `read-aloud-actions.ts` ≥ 90 % de líneas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Barra de lectura, menú, atajos y resaltado de la frase (PDF-114). Voces nativas de Linux por Rust (mejora futura del ADR). Leer comentarios o campos de formulario.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
