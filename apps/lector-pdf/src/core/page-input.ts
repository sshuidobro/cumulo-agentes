/** Indicador de página para el campo de la barra: valor editable y texto que va a su derecha. */
export interface PageIndicator {
  readonly inputValue: string;
  readonly suffix: string;
}

/** Número con separador de miles en el formato español (p. ej. «100.000»). */
function formatCount(n: number): string {
  return n.toLocaleString('es-ES');
}

/**
 * Interpreta lo que escribe el usuario en el campo de página y devuelve el índice 0-based, o `null` si no es válido.
 * Primero se busca una etiqueta de página (sin distinguir mayúsculas); si no hay, un entero entre 1 y `numPages`.
 */
export function parsePageInput(
  text: string,
  numPages: number,
  labels: readonly string[] | null,
): number | null {
  const wanted = text.trim();
  if (wanted === '') return null;

  if (labels !== null) {
    const lower = wanted.toLocaleLowerCase('es-ES');
    const index = labels.findIndex((label) => label.toLocaleLowerCase('es-ES') === lower);
    if (index !== -1) return index;
  }

  if (!/^\d+$/.test(wanted)) return null;
  const n = Number(wanted);
  if (!Number.isSafeInteger(n) || n < 1 || n > numPages) return null;
  return n - 1;
}

/**
 * Valor del campo y sufijo para la página `index` (0-based). Sin etiqueta propia, o con una igual al número,
 * muestra el número («4», «de 300»); con una etiqueta distinta muestra la etiqueta («iv», «(4 de 300)»).
 */
export function formatPageIndicator(
  index: number,
  numPages: number,
  labels: readonly string[] | null,
): PageIndicator {
  const n = index + 1;
  const total = formatCount(numPages);
  const label = labels?.[index];
  if (label === undefined || label === String(n)) {
    return { inputValue: String(n), suffix: `de ${total}` };
  }
  return { inputValue: label, suffix: `(${formatCount(n)} de ${total})` };
}
