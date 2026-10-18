import { useViewer } from './viewer-store';

let lastId = 0;

/** Muestra un aviso temporal. El aviso nuevo sustituye al anterior y reinicia su tiempo. */
export function showNotice(text: string): void {
  lastId += 1;
  useViewer.setState({ notice: { id: lastId, text } });
}

/** Retira el aviso `id` si sigue visible (un aviso posterior no se toca). */
export function dismissNotice(id: number): void {
  if (useViewer.getState().notice?.id === id) useViewer.setState({ notice: null });
}
