import { APP_NAME } from '../core/title';

export const msg = {
  appName: APP_NAME,
  emptyTitle: 'Abre un PDF para empezar',
  emptyHint: 'Arrastra un fichero a esta ventana o pulsa «Abrir».',
  open: 'Abrir…',
  openShortcutHint: (shortcut: string): string => `Atajo de teclado: ${shortcut}`,
  openAnother: 'Abrir otro…',
  opening: (name: string): string => `Abriendo «${name}»…`,
  loadProgress: 'Progreso de carga',
  cancel: 'Cancelar',
  openFailed: (name: string): string => `No se ha podido abrir «${name}»`,
  openFailedGeneric: 'No se ha podido abrir el fichero',
  dropHere: 'Suelta el PDF para abrirlo',
  closeDocument: 'Cerrar documento',
  pageCount: (n: number): string => (n === 1 ? '1 página' : `${n.toLocaleString('es-ES')} páginas`),
  toolbarLabel: 'Barra de herramientas',
} as const;
