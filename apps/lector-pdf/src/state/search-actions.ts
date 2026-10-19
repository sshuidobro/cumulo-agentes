import type { SearchMatch } from '../core/search/find';
import { stepCursor } from '../core/search/cursor';
import { normalizeQuery } from '../core/search/normalize';
import { PageTextCache, SearchSession, type PageTextSource } from '../core/search/session';
import { createPageTextSource } from '../engine/search-source';
import * as registry from '../ui/viewer/text-layer-registry';
import { goToPage } from './navigation';
import { initialSearchState, useSearch, type SearchOptionName, type SearchOptions, type SearchState } from './search-store';
import { isSwitchingTab, registerTabParticipant, type TabParticipant } from './tabs';
import { useViewer } from './viewer-store';

/** Espera tras el último cambio del texto antes de buscar. */
const DEBOUNCE_MS = 250;

/** Lo que necesita una búsqueda para leer un documento. */
export interface SearchBackend {
  readonly numPages: number;
  readonly source: PageTextSource;
  readonly cache: PageTextCache;
}

type BackendProvider = () => SearchBackend | null;

/** Caché de texto por documento: al cambiar de documento, el objeto antiguo y su caché se descartan. */
const cacheByDocument = new WeakMap<object, PageTextCache>();

/** Documento abierto en el visor (pdf.js vía `engine/search-source`). */
function documentBackend(): SearchBackend | null {
  const pdf = useViewer.getState().pdf;
  if (pdf === null) return null;
  let cache = cacheByDocument.get(pdf);
  if (cache === undefined) {
    cache = new PageTextCache();
    cacheByDocument.set(pdf, cache);
  }
  return { numPages: pdf.numPages, source: createPageTextSource(pdf.doc), cache };
}

let provider: BackendProvider = documentBackend;

/** Sustituye la fuente de texto (pruebas). `null` vuelve al documento abierto. */
export function setSearchBackend(next: BackendProvider | null): void {
  provider = next ?? documentBackend;
}

/**
 * Identificador de la búsqueda vigente. Cada búsqueda nueva o cancelada lo cambia, así que los avisos de una
 * sesión antigua se ignoran aunque llegue alguno tarde.
 */
let token = 0;
let activeSession: SearchSession | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function clearDebounce(): void {
  if (debounceTimer === null) return;
  clearTimeout(debounceTimer);
  debounceTimer = null;
}

/** Cancela la búsqueda en curso y vacía sus resultados. Conserva consulta, opciones y el contador de revelado. */
function clearResults(): void {
  token += 1;
  const previous = activeSession;
  activeSession = null;
  previous?.cancel();
  useSearch.setState({
    status: 'idle',
    matchesByPage: new Map(),
    pagesWithMatches: [],
    total: 0,
    truncated: false,
    progress: null,
    current: null,
  });
}

/** Lanza una búsqueda nueva con la consulta y las opciones actuales, que sustituye a la anterior. */
function startSession(): void {
  clearDebounce();
  clearResults();

  const { query, options } = useSearch.getState();
  if (normalizeQuery(query, options).length === 0) return;
  const backend = provider();
  if (backend === null || backend.numPages === 0) return;

  const mine = token;
  const pending = new Map<number, readonly SearchMatch[]>();
  let total = 0;
  const publish = (patch: Partial<SearchState>): void => {
    useSearch.setState({
      matchesByPage: new Map(pending),
      pagesWithMatches: [...pending.keys()].sort((a, b) => a - b),
      total,
      ...patch,
    });
  };

  const session = new SearchSession(
    backend.numPages,
    backend.source,
    { query, ...options },
    useViewer.getState().currentPage,
    {
      onPageMatches(page, matches) {
        if (mine !== token) return;
        pending.set(page, matches);
        total += matches.length;
        // La primera coincidencia encontrada pasa a ser la actual y se muestra. El resto se publica con el progreso.
        const state = useSearch.getState();
        if (state.current === null && matches.length > 0) {
          publish({ current: { page, index: 0 }, revealSeq: state.revealSeq + 1 });
          // Si la página no está montada, el visor va a ella (la revelación completa la posición al montarse).
          if (registry.get(page) === undefined) goToPage(page);
        }
      },
      onProgress(progress) {
        if (mine !== token) return;
        total = progress.matchCount;
        publish({
          status: 'searching',
          progress: { searched: progress.pagesSearched, total: progress.totalPages },
          truncated: progress.truncated,
        });
      },
      onDone(progress) {
        if (mine !== token) return;
        total = progress.matchCount;
        if (activeSession === session) activeSession = null;
        publish({ status: 'done', progress: null, truncated: progress.truncated });
      },
    },
    { cache: backend.cache },
  );

  activeSession = session;
  publish({ status: 'searching', progress: { searched: 0, total: backend.numPages } });
  session.start();
}

/** Abre la barra de búsqueda. La consulta anterior, si la hay, se conserva. */
export function openSearch(): void {
  useSearch.setState({ open: true });
}

/**
 * Cierra la barra: cancela la búsqueda, vacía coincidencias y consulta. Las opciones se conservan.
 * Devolver el foco al visor lo hace la interfaz.
 */
export function closeSearch(): void {
  clearDebounce();
  clearResults();
  useSearch.setState({ open: false, query: '' });
}

/** Cambia la consulta. Espera a que el usuario deje de escribir antes de buscar. */
export function setQuery(query: string): void {
  clearDebounce();
  clearResults();
  useSearch.setState({ query });
  const { options } = useSearch.getState();
  if (normalizeQuery(query, options).length === 0) return;
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    startSession();
  }, DEBOUNCE_MS);
}

/** Activa o desactiva una opción y relanza la búsqueda con la consulta actual. */
export function toggleOption(name: SearchOptionName): void {
  const { options, query } = useSearch.getState();
  useSearch.setState({ options: { ...options, [name]: !options[name] } });
  if (query.length > 0) startSession();
}

/** Detiene la búsqueda en curso. Los resultados encontrados hasta ese momento se conservan. */
export function cancelSearch(): void {
  clearDebounce();
  const session = activeSession;
  if (session === null) return;
  activeSession = null;
  session.cancel();
}

/** Siguiente coincidencia en orden global, con vuelta al principio. */
export function nextMatch(): void {
  moveCurrent(1);
}

/** Anterior coincidencia en orden global, con vuelta al final. */
export function prevMatch(): void {
  moveCurrent(-1);
}

function moveCurrent(direction: 1 | -1): void {
  const state = useSearch.getState();
  const next = stepCursor(
    state.pagesWithMatches,
    (page) => state.matchesByPage.get(page)?.length ?? 0,
    state.current,
    direction,
  );
  if (next === null) return;
  useSearch.setState({ current: next, revealSeq: state.revealSeq + 1 });
  // Si la página no está montada, el visor va a ella; al montarse, la revelación ajusta la posición exacta.
  if (registry.get(next.page) === undefined) goToPage(next.page);
}

/** Al cambiar de documento, la búsqueda anterior no tiene sentido: se cierra. Al cambiar de pestaña, no (lo guarda el participante). */
useViewer.subscribe((state, previous) => {
  if (state.pdf !== previous.pdf && !isSwitchingTab()) closeSearch();
});

/** Lo que se recuerda de la búsqueda de una pestaña suspendida: la barra, la consulta y las opciones. */
interface SearchSnapshot {
  readonly open: boolean;
  readonly query: string;
  readonly options: SearchOptions;
}

const searchParticipant: TabParticipant<SearchSnapshot> = {
  id: 'search',
  order: 30,
  suspend(): SearchSnapshot {
    const { open, query, options } = useSearch.getState();
    // Invalida la búsqueda vigente: lo que llegue de ella después de suspender no debe tocar el store.
    token += 1;
    cancelSearch();
    // Vacía resultados y estado, pero conserva el contador de revelado (no vuelve a 0).
    useSearch.setState({ ...initialSearchState, revealSeq: useSearch.getState().revealSeq });
    return { open, query, options };
  },
  resume(snapshot: SearchSnapshot): void {
    useSearch.setState({ options: snapshot.options });
    if (!snapshot.open) return;
    openSearch();
    // La búsqueda se repite desde la página actual; el resultado es el de una búsqueda nueva.
    setQuery(snapshot.query);
  },
  dispose(): Promise<void> {
    return Promise.resolve();
  },
};

/** Da de alta la búsqueda en el registro de pestañas. Llamar una vez al arrancar. */
export function registerSearchParticipant(): void {
  registerTabParticipant(searchParticipant);
}
