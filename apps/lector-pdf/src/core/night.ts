/**
 * Colores del modo noche: pdf.js sustituye el texto y el fondo del documento por estos, sin invertir las imágenes.
 * El mismo fondo pinta el marco de la página mientras no hay lienzo (ver `Viewer.module.css`, clase `night`).
 */
export const NIGHT_PAGE_COLORS = { background: '#1f1f23', foreground: '#e6e6e6' } as const;
