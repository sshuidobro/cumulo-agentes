---
tipo: tarea
id: PDF-017
titulo: Núcleo de búsqueda - normalización, coincidencias y sesión incremental cancelable
app: pdf
estado: en-curso
depende_de: [PDF-005]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, nucleo, busqueda, rendimiento]
---

# PDF-017 · Núcleo de búsqueda incremental

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · Investigación: [[Paridad Adobe Acrobat]] (área 3) · [[ADR-0012-suite-de-rendimiento]]

## Objetivo
Lógica de búsqueda pura y probada: normaliza texto (mayúsculas, tildes, ligaduras, espacios) conservando el mapa a posiciones originales, encuentra coincidencias (opción palabra completa) expresadas como posiciones **en los ítems de texto de pdf.js** (para resaltarlas sobre la capa de texto), y una sesión que recorre miles de páginas por lotes sin bloquear, empezando por la página actual, con progreso y cancelación.

## Contexto
- Leer: [[ADR-0007-motor-y-visor-pdf]], `src/engine/text.ts` (`TEXT_CONTENT_PARAMS`, PDF-013 — si aún no existe, créalo tal como dice esa ficha en su paso 1, solo la constante y `getPageTextContent`).
- Los ítems de pdf.js con `str` se numeran 0, 1, 2… igual que `TextLayer.textDivs`; `hasEOL` indica fin de línea tras el ítem.
- Medido por el líder: extraer el texto de 5 000 páginas sintéticas con pdf.js en Node tarda ~1,1 s (concurrencia 4).
- `core/` no importa pdfjs: la sesión recibe una fuente de texto abstracta.

## Qué hay que hacer
1. `src/core/search/normalize.ts`:
   ```ts
   export interface SearchOptions { readonly query: string; readonly matchCase: boolean; readonly wholeWord: boolean; readonly matchDiacritics: boolean }
   export interface NormalizedText { readonly text: string; readonly map: Int32Array } // map.length === text.length + 1; map[i] = índice en el original; map[text.length] = longitud original
   export function normalizeText(raw: string, opts: { readonly matchCase: boolean; readonly matchDiacritics: boolean }): NormalizedText;
   export function normalizeQuery(query: string, opts: { readonly matchCase: boolean; readonly matchDiacritics: boolean }): string; // normalizeText + trim
   ```
   Por cada punto de código `c` del original (en orden): `s = c.normalize('NFKC')`; si `!matchDiacritics` → `s.normalize('NFD').replace(/\p{M}/gu, '')`; si `!matchCase` → `s.toLocaleLowerCase('es')`; `U+00AD` (guion blando) → nada; cualquier espacio (`/\s/u`, incluido U+00A0) → un solo `' '` (no se emite si el último carácter emitido ya es `' '`). Cada carácter emitido apunta al índice de `c`.
2. `src/core/search/page-text.ts`:
   ```ts
   export interface TextItemLike { readonly str: string; readonly hasEOL: boolean }
   export interface PageText { readonly raw: string; readonly itemStarts: Int32Array } // itemStarts.length === items + 1
   export interface TextPos { readonly item: number; readonly offset: number }
   export function buildPageText(items: readonly TextItemLike[]): PageText; // concatena; tras un ítem con hasEOL añade '\n' (si el ítem no termina ya en espacio)
   export function rawOffsetToPos(pt: PageText, rawOffset: number): TextPos; // búsqueda binaria; si cae en el '\n' añadido → final del ítem anterior
   ```
3. `src/core/search/find.ts`:
   ```ts
   export interface SearchMatch { readonly pageIndex: number; readonly start: TextPos; readonly end: TextPos } // end exclusivo
   export function findInPage(pageIndex: number, pt: PageText, norm: NormalizedText, query: string, wholeWord: boolean, max?: number): SearchMatch[]; // max por defecto 10 000
   ```
   `indexOf` repetido sobre `norm.text` (sin solapes: sigue tras el final de cada coincidencia). Palabra completa: el carácter anterior y el siguiente (en `norm.text`) no cumplen `/[\p{L}\p{N}_]/u`. Inicio original = `map[i]`; fin original = `map[i + query.length]`.
4. `src/core/search/session.ts`:
   ```ts
   export interface PageTextSource { getPageItems(pageIndex: number, signal: AbortSignal): Promise<readonly TextItemLike[]> }
   export interface SearchProgress { readonly pagesSearched: number; readonly totalPages: number; readonly matchCount: number; readonly truncated: boolean }
   export interface SearchCallbacks {
     onPageMatches(pageIndex: number, matches: readonly SearchMatch[]): void; // solo páginas con ≥ 1 coincidencia, en orden de recorrido
     onProgress(p: SearchProgress): void;                                      // como mucho cada 100 ms
     onDone(p: SearchProgress & { readonly cancelled: boolean }): void;
   }
   export class PageTextCache { constructor(maxPages?: number); get(i: number): PageText | undefined; set(i: number, pt: PageText): void; get size(): number } // por defecto 20 000; al superar, borra la más antigua
   export const MAX_TOTAL_MATCHES = 100_000;
   export class SearchSession {
     constructor(numPages: number, source: PageTextSource, options: SearchOptions, startPage: number, callbacks: SearchCallbacks,
       opts?: { readonly timeSliceMs?: number; readonly concurrency?: number; readonly cache?: PageTextCache; readonly now?: () => number });
     start(): void;   // asíncrono por dentro; no lanza: errores de una página → se cuenta como buscada sin resultados + logger
     cancel(): void;  // aborta lecturas en curso; onDone({ cancelled: true }) una sola vez
   }
   ```
   Orden: `startPage … numPages-1`, luego `0 … startPage-1`. Lecturas con concurrencia (4 por defecto) pero **se procesan en orden**. Cede el hilo (`await new Promise(r => setTimeout(r, 0))`) cuando lleva `timeSliceMs` (8 por defecto) trabajando. Consulta vacía tras normalizar → `onDone` inmediato con 0. Al llegar a `MAX_TOTAL_MATCHES` termina con `truncated: true`.
5. `src/engine/search-source.ts`: `export function createPageTextSource(doc: PDFDocumentProxy): PageTextSource` (`getPage` → `getPageTextContent` → ítems con `str` → `{ str, hasEOL }`).
6. Tests: `tests/unit/search-normalize.test.ts`, `search-find.test.ts`, `search-session.test.ts` (fuente falsa, reloj falso) y `tests/unit/search-engine.test.ts` (motor real con fixtures), más `tests/unit/search.bench.ts`.

## Criterios de aceptación
- [ ] (T) `normalizeText('Búsqueda', { matchCase: false, matchDiacritics: false }).text === 'busqueda'`; con `matchDiacritics: true` → `'búsqueda'`; `'ﬁn'` (ligadura) → `'fin'` con `map = [0, 0, 1, 2]`; `'a    b'` → `'a b'`; `'co­che'` → `'coche'`.
- [ ] (T) `findInPage` en `basic-5.pdf` (texto real del motor): `busqueda` sin tildes ni mayúsculas → coincidencias en p2, p3, p4 (×2) y p5 (dentro de «rebusquedas»); con `wholeWord` → p5 no; con `matchCase` y `matchDiacritics` `búsqueda` → solo p2 y p4.
- [ ] (T) Posiciones: la coincidencia de `murciélago` en la p1 empieza y termina en el ítem que contiene ese texto, con `offset` correcto (comprueba `items[start.item].str.slice(start.offset, end.offset) === 'murciélago'` cuando está en un solo ítem).
- [ ] (T) Una coincidencia que cruza dos ítems (`'kiwi. marcador'` con ítems simulados `['...kiwi.', ' marcador-1']`) da `start.item !== end.item`.
- [ ] (T) Sesión con 10 páginas falsas, `startPage 7`: orden de `onPageMatches` 7, 8, 9, 0, …, 6; `cancel()` a mitad → `onDone({ cancelled: true })` una vez y ninguna llamada posterior; consulta `'   '` → `onDone` con 0 sin leer páginas; una página que rechaza no detiene la búsqueda.
- [ ] (T) Motor real, `pages-5000.pdf`, consulta `aguja`, `startPage 0` → coincidencias exactamente en las páginas 1233 y 4998 (0-based).
- [ ] (T, rendimiento, `tests/perf/search.perf.test.ts`, medida única con el reloj real `performance.now()` como `now`) motor real, `pages-5000.pdf`, `aguja`: recorrido completo < 10 s; ningún intervalo entre cesiones del hilo > 50 ms; anota tiempos.
- [ ] (T) Con `PageTextCache`, una segunda búsqueda en `pages-5000.pdf` no vuelve a llamar a `getPageItems`.
- [ ] (T, rendimiento, `tests/perf/search.perf.test.ts`) esa segunda búsqueda con caché termina en < 1 s.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm perf` con código 0; `src/core/search/` ≥ 95 % de líneas.

## Fuera de alcance
- Interfaz y resaltado (PDF-018). Expresiones regulares, búsqueda en varios PDFs (opcionales de la nota de paridad). Texto partido por guiones de fin de línea.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [lider] suite de rendimiento — 2026-10-17
Por [[ADR-0012-suite-de-rendimiento]], los asserts de tiempo de reloj (`performance.now()`) no van en `tests/unit/` ni `tests/ui/` (fallan bajo `pnpm coverage`), sino en `tests/perf/*.perf.test.ts`, que se ejecuta con `pnpm perf` (sin cobertura, en serie). Presupuestos sin cambios. Los relojes falsos inyectados (`now`) siguen en `tests/unit/`.
Si `vitest.perf.config.ts` (raíz), el script `perf` del `package.json` raíz, su entrada en `tsconfig.json` y `apps/lector-pdf/tests/perf/measure.ts` aún no existen (PDF-006 sin terminar), créalos **exactamente** como dice [[PDF-006-layout-virtual]] (Registro, entrada del líder, pasos 1-4); si existen, no los cambies.
