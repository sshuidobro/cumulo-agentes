/** Detección de plataforma en un único sitio (ADR-0008). */
export function isTauri(win: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in win;
}
