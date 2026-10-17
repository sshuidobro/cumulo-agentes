/** Ítem de texto de una página, con la forma mínima que necesita la búsqueda (pdf.js `TextItem`). */
export interface TextItemLike {
  readonly str: string;
  readonly hasEOL: boolean;
}

/**
 * Texto de una página: los `str` de los ítems concatenados.
 * `itemStarts[i]` es el primer índice de `raw` que pertenece al ítem `i`; `itemStarts[items.length] === raw.length`.
 * El `\n` que se añade tras un ítem con fin de línea pertenece a ese ítem.
 */
export interface PageText {
  readonly raw: string;
  readonly itemStarts: Int32Array;
}

/** Posición dentro de los ítems de pdf.js: `offset` es una unidad UTF-16 dentro de `items[item].str` (0 … str.length). */
export interface TextPos {
  readonly item: number;
  readonly offset: number;
}

/** Concatena los ítems de una página. Tras un ítem con `hasEOL` añade `\n`, salvo que ya termine en espacio. */
export function buildPageText(items: readonly TextItemLike[]): PageText {
  const itemStarts = new Int32Array(items.length + 1);
  const parts: string[] = [];
  let length = 0;

  items.forEach((item, i) => {
    itemStarts[i] = length;
    parts.push(item.str);
    length += item.str.length;
    if (item.hasEOL && !/\s$/u.test(item.str)) {
      parts.push('\n');
      length += 1;
    }
  });
  itemStarts[items.length] = length;

  return { raw: parts.join(''), itemStarts };
}

/**
 * Convierte un índice de `raw` en una posición de ítem. Un índice que cae en el `\n` añadido
 * da el final del ítem al que pertenece (offset = longitud del `str`).
 */
export function rawOffsetToPos(pt: PageText, rawOffset: number): TextPos {
  const count = pt.itemStarts.length - 1;
  if (count <= 0) return { item: 0, offset: 0 };

  // Búsqueda binaria: último ítem cuyo inicio es ≤ rawOffset.
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const mid = (low + high + 1) >>> 1;
    if ((pt.itemStarts[mid] ?? 0) <= rawOffset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return { item: low, offset: rawOffset - (pt.itemStarts[low] ?? 0) };
}
