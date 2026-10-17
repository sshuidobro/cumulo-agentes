import type { Platform } from '@suite/platform';

/** Dependencias de la app que se crean una vez en `main.tsx`. */
export interface AppServices {
  readonly platform: Platform;
  /** Carpeta de recursos de pdf.js (cmaps, fuentes, wasm). Termina en '/'. */
  readonly assetBaseUrl: string;
}

let current: AppServices | null = null;

export function initServices(services: AppServices): void {
  current = services;
}

/** Servicios de la app. Llamarlo antes de `initServices` es un bug, por eso lanza. */
export function services(): AppServices {
  if (current === null) throw new Error('Servicios no inicializados');
  return current;
}
