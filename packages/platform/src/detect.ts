import type { Platform } from './types';

/** Detección de plataforma en un único sitio (ADR-0008). */
export function isTauri(win: object = globalThis): boolean {
  return '__TAURI_INTERNALS__' in win;
}

export async function loadPlatform(options: { readonly prefsPrefix: string }): Promise<Platform> {
  const web = await import('./web/index');
  return web.createWebPlatform(options);
} // COM-010 añade la rama Tauri
