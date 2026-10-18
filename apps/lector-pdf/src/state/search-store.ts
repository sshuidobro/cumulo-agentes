import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { SearchMatch } from '../core/search/find';
import type { MatchCursor } from '../core/search/cursor';

/** Opciones de búsqueda que el usuario conmuta. Por defecto no distinguen mayúsculas ni tildes. */
export interface SearchOptions {
  readonly matchCase: boolean;
  readonly wholeWord: boolean;
  readonly matchDiacritics: boolean;
}

export type SearchOptionName = keyof SearchOptions;

/** Estado de la búsqueda en el documento abierto (PDF-018). Separado del visor. */
export interface SearchState {
  readonly open: boolean;
  readonly query: string;
  readonly options: SearchOptions;
  readonly status: 'idle' | 'searching' | 'done';
  /** Coincidencias por página (0-based). Solo páginas con al menos una coincidencia. */
  readonly matchesByPage: ReadonlyMap<number, readonly SearchMatch[]>;
  /** Páginas con coincidencias, ordenadas. */
  readonly pagesWithMatches: readonly number[];
  readonly total: number;
  /** `true` si se alcanzó el tope de coincidencias y la lista está incompleta. */
  readonly truncated: boolean;
  readonly progress: { readonly searched: number; readonly total: number } | null;
  readonly current: MatchCursor | null;
  /** Sube cada vez que hay que mostrar la coincidencia actual (crece siempre; nunca vuelve a 0). */
  readonly revealSeq: number;
}

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  matchCase: false,
  wholeWord: false,
  matchDiacritics: false,
};

export const initialSearchState: SearchState = {
  open: false,
  query: '',
  options: DEFAULT_SEARCH_OPTIONS,
  status: 'idle',
  matchesByPage: new Map(),
  pagesWithMatches: [],
  total: 0,
  truncated: false,
  progress: null,
  current: null,
  revealSeq: 0,
};

export const useSearch: UseBoundStore<StoreApi<SearchState>> = create<SearchState>()(() => initialSearchState);
