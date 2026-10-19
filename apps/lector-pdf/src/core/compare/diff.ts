export type DiffOp = {
  readonly kind: 'equal' | 'delete' | 'insert';
  readonly aStart: number;
  readonly aEnd: number;
  readonly bStart: number;
  readonly bEnd: number;
};

/**
 * Myers O(ND) sobre dos listas de cadenas. `null` si hacen falta más de `maxD` ediciones.
 * Operaciones contiguas del mismo tipo fusionadas. Un `delete` es `a[aStart..aEnd)` sin contrapartida (bStart === bEnd);
 * un `insert` es `b[bStart..bEnd)` sin contrapartida (aStart === aEnd).
 */
export function diffSequences(texts: readonly string[], otherTexts: readonly string[], maxD: number): readonly DiffOp[] | null {
  // Cada cadena se sustituye por un entero de un diccionario común: el bucle compara enteros, no cadenas.
  const ids = new Map<string, number>();
  const toIds = (list: readonly string[]): Int32Array => {
    const out = new Int32Array(list.length);
    list.forEach((text, i) => {
      let id = ids.get(text);
      if (id === undefined) {
        id = ids.size;
        ids.set(text, id);
      }
      out[i] = id;
    });
    return out;
  };
  const a = toIds(texts);
  const b = toIds(otherTexts);
  const n = a.length;
  const m = b.length;
  const cap = Math.max(0, Math.min(Math.trunc(maxD), n + m));
  // v[offset + k] es el avance máximo en x de la diagonal k (x - y = k).
  const offset = cap + 1;
  const v = new Int32Array(2 * cap + 3);
  // Traza: tras el paso d solo se guardan las diagonales k de paridad d, en steps[d][(k + d) / 2].
  // La vuelta atrás necesita exactamente esos valores; así la memoria es ~D²/2 enteros.
  const steps: Int32Array[] = [];

  let foundD = -1;
  for (let d = 0; d <= cap && foundD < 0; d++) {
    const step = new Int32Array(d + 1);
    steps.push(step);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) {
        x = v[offset + k + 1] ?? 0;
      } else {
        x = (v[offset + k - 1] ?? 0) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      step[(k + d) >> 1] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
  }
  if (foundD < 0) return null;

  // Vuelta atrás desde (n, m): en orden inverso, se construyen las operaciones.
  const reversed: DiffOp[] = [];
  const pushOp = (kind: DiffOp['kind'], aStart: number, aEnd: number, bStart: number, bEnd: number): void => {
    if (aEnd > aStart || bEnd > bStart) reversed.push({ kind, aStart, aEnd, bStart, bEnd });
  };
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const k = x - y;
    const prev = steps[d - 1] ?? new Int32Array(0);
    const at = (diagonal: number): number => prev[(diagonal + d - 1) >> 1] ?? 0;
    const fromDown = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const prevK = fromDown ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    const midX = fromDown ? prevX : prevX + 1;
    const midY = fromDown ? prevY + 1 : prevY;

    pushOp('equal', midX, x, midY, y);
    if (fromDown) {
      pushOp('insert', prevX, prevX, prevY, midY);
    } else {
      pushOp('delete', prevX, midX, prevY, prevY);
    }
    x = prevX;
    y = prevY;
  }
  pushOp('equal', 0, x, 0, y);

  return mergeOps(reversed.reverse());
}

function mergeOps(ops: readonly DiffOp[]): DiffOp[] {
  const merged: DiffOp[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.kind === op.kind && last.aEnd === op.aStart && last.bEnd === op.bStart) {
      merged[merged.length - 1] = { ...last, aEnd: op.aEnd, bEnd: op.bEnd };
    } else {
      merged.push(op);
    }
  }
  return merged;
}
