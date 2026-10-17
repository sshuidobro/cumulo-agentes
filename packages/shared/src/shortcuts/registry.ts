import { chordId, formatChord, matchChord, parseChord } from './chord';
import type { KeyChord, KeyEventLike } from './chord';

export interface ShortcutDef<Id extends string> {
  readonly id: Id;
  /** Atajos en texto, p. ej. ['Mod+S'] o ['Mod+Plus', 'Mod+code:NumpadAdd']. */
  readonly chords: readonly string[];
  readonly description: string;
}

interface Entry<Id extends string> {
  readonly id: Id;
  readonly chord: KeyChord;
}

/** Registro único de atajos de una app. Se construye una vez con todas las definiciones. */
export class ShortcutRegistry<Id extends string> {
  readonly #defs: readonly ShortcutDef<Id>[];
  readonly #entries: readonly Entry<Id>[];

  /** Parsea todos los atajos. Lanza si uno no es válido o si dos atajos coinciden. */
  constructor(defs: readonly ShortcutDef<Id>[]) {
    const seen = new Set<string>();
    const entries: Entry<Id>[] = [];
    for (const def of defs) {
      for (const text of def.chords) {
        const chord = parseChord(text);
        const id = chordId(chord);
        if (seen.has(id)) throw new Error(`Atajo duplicado: ${text}`);
        seen.add(id);
        entries.push({ id: def.id, chord });
      }
    }
    this.#defs = defs;
    this.#entries = entries;
  }

  /** Id del primer atajo que coincide con el evento (en orden de definición), o `null`. */
  match(e: KeyEventLike, isMac: boolean): Id | null {
    for (const entry of this.#entries) {
      if (matchChord(e, entry.chord, isMac)) return entry.id;
    }
    return null;
  }

  /** Atajos de un id, formateados para mostrar. Lista vacía si el id no tiene atajos. */
  chordsFor(id: Id, isMac: boolean): string[] {
    return this.#entries
      .filter((entry) => entry.id === id)
      .map((entry) => formatChord(entry.chord, isMac));
  }

  list(): readonly ShortcutDef<Id>[] {
    return this.#defs;
  }
}
