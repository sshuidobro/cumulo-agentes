/** Nombre de la aplicación (único sitio; `ui/messages.ts` lo reexporta). */
export const APP_NAME = 'Lector PDF';

/** Título de la ventana: nombre del fichero, marca de cambios sin guardar y nombre de la app. */
export function windowTitle(fileName: string | null, dirty: boolean): string {
  if (fileName === null) return APP_NAME;
  const name = dirty ? `• ${fileName}` : fileName;
  return `${name} — ${APP_NAME}`;
}
