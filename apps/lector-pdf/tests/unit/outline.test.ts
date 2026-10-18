import { describe, expect, it } from 'vitest';
import {
  allIds,
  flattenVisible,
  initialExpanded,
  MAX_OUTLINE_DEPTH,
  toOutlineNodes,
  UNTITLED_OUTLINE_TITLE,
  type OutlineNode,
  type RawOutlineItem,
} from '../../src/core/outline';

/** Nodo de prueba con la forma que da pdf.js (una sola raíz por llamada). */
function raw(title: string, extra: Partial<RawOutlineItem> = {}): RawOutlineItem {
  return { title, ...extra };
}

/** Árbol de referencia de `outline.pdf` (sin enlaces reales): Capítulo 1 con dos secciones, Capítulo 2. */
function sampleTree(): readonly OutlineNode[] {
  return toOutlineNodes([
    raw('Capítulo 1', {
      bold: true,
      count: 2,
      dest: 'c1',
      items: [
        raw('Sección 1.1', { count: 1, dest: 's11', items: [raw('Apartado 1.1.1', { dest: 'a111' })] }),
        raw('Sección 1.2', { dest: 's12' }),
      ],
    }),
    raw('Capítulo 2', { dest: 'c2', items: [raw('Sección 2.1', { italic: true, dest: 's21' })] }),
  ]);
}

describe('toOutlineNodes', () => {
  it('sin índice (null) o con lista vacía devuelve un árbol vacío', () => {
    expect(toOutlineNodes(null)).toEqual([]);
    expect(toOutlineNodes([])).toEqual([]);
  });

  it('las ids son la ruta de índices en el árbol original', () => {
    const nodes = sampleTree();
    expect(nodes.map((n) => n.id)).toEqual(['0', '1']);
    expect(nodes[0]?.children.map((n) => n.id)).toEqual(['0.0', '0.1']);
    expect(nodes[0]?.children[0]?.children.map((n) => n.id)).toEqual(['0.0.0']);
  });

  it('negrita y cursiva vienen del PDF; por defecto son falsas', () => {
    const [chapter1, chapter2] = sampleTree();
    expect(chapter1?.bold).toBe(true);
    expect(chapter1?.italic).toBe(false);
    expect(chapter2?.bold).toBe(false);
    expect(chapter2?.children[0]?.italic).toBe(true);
  });

  it('initiallyExpanded es true solo si el contador es positivo (abierto en el PDF)', () => {
    const nodes = toOutlineNodes([
      raw('Abierto', { count: 3 }),
      raw('Cerrado', { count: -3 }),
      raw('Sin hijos', {}),
      raw('Contador cero', { count: 0 }),
      raw('Contador no numérico', { count: '2' }),
    ]);
    expect(nodes.map((n) => n.initiallyExpanded)).toEqual([true, false, false, false, false]);
  });

  it('limpia el título: recorta, colapsa blancos y sustituye caracteres de control', () => {
    const [node] = toOutlineNodes([raw('  Introducción\u0000\t  general\n ')]);
    expect(node?.title).toBe('Introducción general');
  });

  it('un título vacío, solo blancos o no textual se muestra como «(sin título)»', () => {
    const nodes = toOutlineNodes([raw(''), raw('   \n'), { title: 42 }, {}]);
    expect(nodes.map((n) => n.title)).toEqual([UNTITLED_OUTLINE_TITLE, UNTITLED_OUTLINE_TITLE, UNTITLED_OUTLINE_TITLE, UNTITLED_OUTLINE_TITLE]);
    expect(UNTITLED_OUTLINE_TITLE).toBe('(sin título)');
  });

  it('clasifica el destino de cada marcador como lo hacen los enlaces', () => {
    const nodes = toOutlineNodes([
      raw('Interno', { dest: 'anexo' }),
      raw('Web', { url: 'https://example.org/' }),
      raw('Script', { url: 'javascript:alert(1)' }),
      raw('Inseguro', { unsafeUrl: 'file:///etc/passwd' }),
      raw('Acción', { action: { name: 'NextPage' } }),
      raw('Desconocido', { action: { name: 'Launch' } }),
      raw('Sin destino'),
    ]);
    expect(nodes.map((n) => n.target)).toEqual([
      { kind: 'internal', dest: 'anexo' },
      { kind: 'external', url: 'https://example.org/' },
      { kind: 'blocked', reason: 'unsafe-url' },
      { kind: 'blocked', reason: 'unsafe-url' },
      { kind: 'action', action: 'next-page' },
      { kind: 'blocked', reason: 'unsupported' },
      { kind: 'blocked', reason: 'unsupported' },
    ]);
  });

  it('ignora las entradas que no son objetos y conserva la ruta de las demás', () => {
    const nodes = toOutlineNodes([null, 'texto', raw('Válido')] as unknown as RawOutlineItem[]);
    expect(nodes.map((n) => n.id)).toEqual(['2']);
    expect(nodes[0]?.title).toBe('Válido');
  });

  it('no lanza con 200 niveles de anidación y corta en el nivel 64', () => {
    let item: RawOutlineItem = raw('Hoja');
    for (let level = 199; level >= 0; level--) item = raw(`Nivel ${String(level)}`, { items: [item] });

    let nodes: readonly OutlineNode[] = [];
    expect(() => {
      nodes = toOutlineNodes([item]);
    }).not.toThrow();

    let depth = 0;
    let cursor: readonly OutlineNode[] = nodes;
    while (cursor.length > 0) {
      depth += 1;
      cursor = cursor[0]?.children ?? [];
    }
    expect(depth).toBe(MAX_OUTLINE_DEPTH);
  });
});

describe('flattenVisible', () => {
  it('con Capítulo 1 desplegado y Sección 1.1 contraída muestra solo sus filas visibles, en orden', () => {
    const nodes = sampleTree();
    const rows = flattenVisible(nodes, new Set(['0']));
    expect(rows.map((r) => [r.node.title, r.depth])).toEqual([
      ['Capítulo 1', 0],
      ['Sección 1.1', 1],
      ['Sección 1.2', 1],
      ['Capítulo 2', 0],
    ]);
    expect(rows[1]?.parentId).toBe('0');
    expect(rows[0]?.parentId).toBeNull();
  });

  it('desplegar un nivel más muestra sus hijos justo debajo de su padre', () => {
    const rows = flattenVisible(sampleTree(), new Set(['0', '0.0']));
    expect(rows.map((r) => r.node.title)).toEqual([
      'Capítulo 1',
      'Sección 1.1',
      'Apartado 1.1.1',
      'Sección 1.2',
      'Capítulo 2',
    ]);
  });

  it('sin nada desplegado solo se ven las raíces', () => {
    const rows = flattenVisible(sampleTree(), new Set());
    expect(rows.map((r) => r.node.id)).toEqual(['0', '1']);
  });
});

describe('initialExpanded y allIds', () => {
  it('initialExpanded recoge los nodos con hijos que el PDF deja abiertos', () => {
    const nodes = toOutlineNodes([
      raw('A', { count: 1, items: [raw('A1', { count: 2, items: [raw('A1a')] })] }),
      raw('B', { count: -1, items: [raw('B1')] }),
      raw('C'),
    ]);
    expect([...initialExpanded(nodes)].sort()).toEqual(['0', '0.0']);
  });

  it('allIds recoge todos los nodos que tienen hijos, a cualquier nivel', () => {
    expect([...allIds(sampleTree())].sort()).toEqual(['0', '0.0', '1']);
    expect(allIds([]).size).toBe(0);
  });
});
