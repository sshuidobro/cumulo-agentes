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

  // Prefijo y sufijo comunes: son iguales en cualquier alineación mínima, así que no cuentan como ediciones
  // y el núcleo de Myers trabaja solo con el tramo que de verdad cambia.
  const shortest = Math.min(n, m);
  let prefix = 0;
  while (prefix < shortest && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < shortest - prefix && a[n - 1 - suffix] === b[m - 1 - suffix]) suffix += 1;

  const core = myersCore(a.subarray(prefix, n - suffix), b.subarray(prefix, m - suffix), maxD);
  if (core === null) return null;

  const ops: DiffOp[] = [];
  if (prefix > 0) ops.push({ kind: 'equal', aStart: 0, aEnd: prefix, bStart: 0, bEnd: prefix });
  for (const op of core) {
    ops.push({
      kind: op.kind,
      aStart: op.aStart + prefix,
      aEnd: op.aEnd + prefix,
      bStart: op.bStart + prefix,
      bEnd: op.bEnd + prefix,
    });
  }
  if (suffix > 0) ops.push({ kind: 'equal', aStart: n - suffix, aEnd: n, bStart: m - suffix, bEnd: m });
  return mergeOps(ops);
}

/** Buffer de la traza de Myers, reutilizado entre páginas (no se pone a cero: solo se leen valores escritos en la misma llamada). */
let traceBuffer = new Int32Array(0);

/** Núcleo de Myers sobre enteros ya sin prefijo ni sufijo comunes. Devuelve las operaciones en orden, sin fusionar. */
function myersCore(a: Int32Array, b: Int32Array, maxD: number): DiffOp[] | null {
  const n = a.length;
  const m = b.length;
  const cap = Math.max(0, Math.min(Math.trunc(maxD), n + m));
  // v[offset + k] es el avance máximo en x de la diagonal k (x - y = k).
  const offset = cap + 1;
  const v = new Int32Array(2 * cap + 3);
  // Traza: tras el paso d solo se guardan las diagonales k de paridad d, en trace[d(d+1)/2 + (k + d) / 2].
  // La vuelta atrás necesita exactamente esos valores; así la memoria es ~D²/2 enteros.
  // Se reserva de una vez para todos los pasos posibles (sin crecimiento dentro del bucle).
  const traceSize = ((cap + 1) * (cap + 2)) / 2;
  if (traceBuffer.length < traceSize) traceBuffer = new Int32Array(traceSize);
  const trace = traceBuffer;

  let foundD = -1;
  for (let d = 0; d <= cap && foundD < 0; d++) {
    const base = (d * (d + 1)) / 2;
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
      trace[base + ((k + d) >> 1)] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
  }
  if (foundD < 0) return null;

  // Vuelta atrás desde (n, m): en orden inverso, se construyen las operaciones.
  const reversed: DiffOp[] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d > 0; d--) {
    const k = x - y;
    // Valores del paso d-1 (todos escritos: el paso d-1 cubre las diagonales que se leen aquí).
    const prevBase = ((d - 1) * d) / 2;
    const fromDown =
      k === -d || (k !== d && (trace[prevBase + ((k - 1 + d - 1) >> 1)] ?? 0) < (trace[prevBase + ((k + 1 + d - 1) >> 1)] ?? 0));
    const prevK = fromDown ? k + 1 : k - 1;
    const prevX = trace[prevBase + ((prevK + d - 1) >> 1)] ?? 0;
    const prevY = prevX - prevK;
    const midX = fromDown ? prevX : prevX + 1;
    const midY = fromDown ? prevY + 1 : prevY;

    pushOp(reversed, 'equal', midX, x, midY, y);
    if (fromDown) {
      pushOp(reversed, 'insert', prevX, prevX, prevY, midY);
    } else {
      pushOp(reversed, 'delete', prevX, midX, prevY, prevY);
    }
    x = prevX;
    y = prevY;
  }
  pushOp(reversed, 'equal', 0, x, 0, y);

  return reversed.reverse();
}

function pushOp(ops: DiffOp[], kind: DiffOp['kind'], aStart: number, aEnd: number, bStart: number, bEnd: number): void {
  if (aEnd > aStart || bEnd > bStart) ops.push({ kind, aStart, aEnd, bStart, bEnd });
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
