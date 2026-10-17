import type { PlatformErrorCode } from './types';

export const PLATFORM_MESSAGES: Readonly<Record<PlatformErrorCode, string>> = {
  'not-found': 'No se encuentra el fichero. Puede que se haya movido o borrado.',
  'permission-denied': 'No hay permiso para acceder al fichero.',
  'io': 'No se ha podido leer o escribir el fichero.',
  'changed-on-disk': 'El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como».',
  'save-in-place-unsupported': 'Este navegador no permite guardar encima del original. Se guardará una copia.',
  'unsupported': 'Esta acción no está disponible en esta versión.',
  'out-of-range': 'Se ha intentado leer fuera del fichero.',
};
