import { allIds } from '../core/outline';
import { useViewer } from './viewer-store';

/** Despliega o contrae un marcador del índice. */
export function toggleOutlineNode(id: string): void {
  const { outlineExpanded } = useViewer.getState();
  const next = new Set(outlineExpanded);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  useViewer.setState({ outlineExpanded: next });
}

/** Despliega todos los marcadores que tienen hijos. */
export function expandAllOutline(): void {
  const { outline } = useViewer.getState();
  if (outline === null) return;
  useViewer.setState({ outlineExpanded: allIds(outline) });
}

/** Contrae todos los marcadores. */
export function collapseAllOutline(): void {
  useViewer.setState({ outlineExpanded: new Set<string>() });
}
