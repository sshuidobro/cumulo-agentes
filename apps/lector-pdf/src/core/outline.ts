/**
 * Índice (marcadores) del PDF como árbol. Lógica pura: los datos vienen de pdf.js pero se tratan como
 * entrada no confiable (PDF-016), así que cada campo se valida antes de usarlo.
 */
import { linkTargetFromAnnotation, type LinkTarget } from './links';

/** Título que se muestra a un marcador sin texto. Lo usa también la interfaz (`ui/messages.ts`). */
export const UNTITLED_OUTLINE_TITLE = '(sin título)';

/** Niveles máximos del índice: lo que hay más abajo se ignora (índices recursivos o maliciosos). */
export const MAX_OUTLINE_DEPTH = 64;

/** Elemento de `doc.getOutline()` de pdf.js, con cada campo sin validar. */
export interface RawOutlineItem {
  readonly title?: unknown;
  readonly bold?: unknown;
  readonly italic?: unknown;
  readonly dest?: unknown;
  readonly url?: unknown;
  readonly unsafeUrl?: unknown;
  readonly action?: unknown;
  readonly count?: unknown;
  readonly items?: readonly RawOutlineItem[];
}

/** Marcador validado. `id` es la ruta de índices en el árbol original (`"0"`, `"0.1"`, `"0.1.0"`). */
export interface OutlineNode {
  readonly id: string;
  readonly title: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly target: LinkTarget;
  readonly initiallyExpanded: boolean;
  readonly children: readonly OutlineNode[];
}

/** Fila visible del árbol aplanado: el nodo, su profundidad (0 en la raíz) y el id de su padre. */
export interface VisibleRow {
  readonly node: OutlineNode;
  readonly depth: number;
  readonly parentId: string | null;
}

/** Convierte el índice que da pdf.js en nodos validados. `null` (sin índice) es un árbol vacío. */
export function toOutlineNodes(raw: readonly RawOutlineItem[] | null): readonly OutlineNode[] {
  return buildLevel(raw ?? [], [], 0);
}

function buildLevel(items: readonly unknown[], path: readonly number[], depth: number): OutlineNode[] {
  if (depth >= MAX_OUTLINE_DEPTH) return [];
  const nodes: OutlineNode[] = [];
  items.forEach((raw, index) => {
    if (!isRecord(raw)) return;
    const nodePath = [...path, index];
    nodes.push({
      id: nodePath.join('.'),
      title: cleanTitle(raw.title),
      bold: raw.bold === true,
      italic: raw.italic === true,
      target: linkTargetFromAnnotation(raw),
      initiallyExpanded: typeof raw.count === 'number' && raw.count > 0,
      children: buildLevel(asList(raw.items), nodePath, depth + 1),
    });
  });
  return nodes;
}

/** Título legible: los caracteres de control pasan a espacio, se colapsan los blancos y se recorta. */
function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') return UNTITLED_OUTLINE_TITLE;
  const text = value.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  return text === '' ? UNTITLED_OUTLINE_TITLE : text;
}

/** Filas visibles en orden de documento: los hijos de un nodo aparecen solo si está en `expanded`. */
export function flattenVisible(nodes: readonly OutlineNode[], expanded: ReadonlySet<string>): readonly VisibleRow[] {
  const rows: VisibleRow[] = [];
  const walk = (level: readonly OutlineNode[], depth: number, parentId: string | null): void => {
    for (const node of level) {
      rows.push({ node, depth, parentId });
      if (node.children.length > 0 && expanded.has(node.id)) walk(node.children, depth + 1, node.id);
    }
  };
  walk(nodes, 0, null);
  return rows;
}

/** Nodos desplegados al abrir el documento: los que el PDF marca como abiertos (contador positivo). */
export function initialExpanded(nodes: readonly OutlineNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (level: readonly OutlineNode[]): void => {
    for (const node of level) {
      if (node.children.length === 0) continue;
      if (node.initiallyExpanded) ids.add(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** Ids de todos los nodos que tienen hijos (para «Expandir todo»). */
export function allIds(nodes: readonly OutlineNode[]): ReadonlySet<string> {
  const ids = new Set<string>();
  const walk = (level: readonly OutlineNode[]): void => {
    for (const node of level) {
      if (node.children.length === 0) continue;
      ids.add(node.id);
      walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
