import type { Command } from '../../src/undo';

export function insertText(pos: number, text: string, mergeKey?: string): Command<string> {
  return {
    label: 'escribir',
    ...(mergeKey === undefined ? {} : { mergeKey }),
    apply: (doc) => doc.slice(0, pos) + text + doc.slice(pos),
    invert: () => deleteText(pos, text.length),
  };
}

export function deleteText(pos: number, length: number): Command<string> {
  return {
    label: 'borrar',
    apply: (doc) => doc.slice(0, pos) + doc.slice(pos + length),
    invert: (before) => insertText(pos, before.slice(pos, pos + length)),
  };
}
