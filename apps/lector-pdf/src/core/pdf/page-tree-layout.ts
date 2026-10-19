/**
 * Forma del árbol `/Pages` nuevo (PDF-052, PDF-119): cuántos hijos tiene cada nodo y en qué posición va cada
 * página. No sabe nada de objetos ni de números: solo agrupa posiciones de la lista de páginas.
 */

/** Hijos por nodo `/Pages` (árbol equilibrado). */
export const PAGE_TREE_FANOUT = 32;

/** Hijo de un nodo: una posición de la lista de páginas (`slot`) o un nodo intermedio (`node`). */
export type TreeChild = { readonly slot: number } | { readonly node: TreeNode };

export interface TreeNode {
  readonly kids: readonly TreeChild[];
  /** Número de páginas bajo este nodo. */
  readonly count: number;
}

/** Árbol de abajo arriba para `slotCount` páginas: cada nivel agrupa de 32 en 32 hasta que cabe en la raíz. */
export function planPageTree(slotCount: number): TreeNode {
  let layer: readonly TreeChild[] = Array.from({ length: slotCount }, (_, slot) => ({ slot }));
  while (layer.length > PAGE_TREE_FANOUT) {
    const upper: TreeChild[] = [];
    for (let at = 0; at < layer.length; at += PAGE_TREE_FANOUT) {
      const kids = layer.slice(at, at + PAGE_TREE_FANOUT);
      upper.push({ node: { kids, count: kids.reduce((n, kid) => n + countOf(kid), 0) } });
    }
    layer = upper;
  }
  return { kids: layer, count: slotCount };
}

function countOf(child: TreeChild): number {
  return 'node' in child ? child.node.count : 1;
}
