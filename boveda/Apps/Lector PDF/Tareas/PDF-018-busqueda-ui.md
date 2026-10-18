---
tipo: tarea
id: PDF-018
titulo: Búsqueda en la interfaz (Ctrl+F, opciones, resaltado, siguiente/anterior, progreso)
app: pdf
estado: en-curso
depende_de: [PDF-017, PDF-013]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, busqueda]
---

# PDF-018 · Búsqueda en la interfaz

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]]

## Objetivo
Ctrl+F abre una barra de búsqueda. Mientras se escribe, se busca en todo el documento sin congelar la interfaz, mostrando progreso («Buscando… 1.234 de 5.000 páginas») y el contador («3 de 120»). Las coincidencias se resaltan sobre el texto (la actual con otro color), Intro/F3 va a la siguiente y Mayús+Intro/Mayús+F3 a la anterior, centrando la coincidencia en pantalla. Opciones: coincidir mayúsculas, palabras completas, distinguir tildes.

## Contexto
- Leer: `src/core/search/*` y `src/engine/search-source.ts` (PDF-017), `src/ui/viewer/text-layer-registry.ts` y `TextLayerView.tsx` (PDF-013), `src/ui/viewer/PageView.tsx`, `src/state/navigation.ts`, `src/ui/use-shortcuts.ts`.
- Un `Range` sobre el nodo de texto de `textDivs[i]` (su `firstChild`) con `getClientRects()` da los rectángulos exactos ya transformados (zoom y rotación incluidos).

## Qué hay que hacer
1. `src/state/search-store.ts` (zustand, separado del visor):
   ```ts
   export interface SearchState {
     readonly open: boolean; readonly query: string;
     readonly options: { readonly matchCase: boolean; readonly wholeWord: boolean; readonly matchDiacritics: boolean };
     readonly status: 'idle' | 'searching' | 'done';
     readonly matchesByPage: ReadonlyMap<number, readonly SearchMatch[]>; readonly pagesWithMatches: readonly number[]; // ordenadas
     readonly total: number; readonly truncated: boolean;
     readonly progress: { readonly searched: number; readonly total: number } | null;
     readonly current: { readonly page: number; readonly index: number } | null;
     readonly revealSeq: number; // sube cada vez que hay que mostrar la coincidencia actual
   }
   ```
   Acciones (`src/state/search-actions.ts`): `openSearch()`, `closeSearch()` (cancela, limpia y devuelve el foco al visor), `setQuery(q)` (relanza con *debounce* de 250 ms), `toggleOption(name)` (relanza), `nextMatch()`, `prevMatch()`, `cancelSearch()`. Cada búsqueda crea un `SearchSession` nuevo (cancela el anterior) con `startPage = currentPage` y un `PageTextCache` por documento (se descarta al cambiar de documento). La primera coincidencia encontrada pasa a ser la actual y se revela. `next/prev` recorren en orden global (página, posición) con vuelta al principio/final.
2. `src/ui/search/SearchBar.tsx` (+ CSS Module), flotante arriba a la derecha del visor:
   - `<input type="search" aria-label={msg.searchInput} placeholder={msg.searchPlaceholder}>`; Intro → siguiente, Mayús+Intro → anterior, Esc → cerrar.
   - Botones «Anterior» y «Siguiente» (iconos con `title` y atajos), y tres botones conmutables con `aria-pressed`: «Coincidir mayúsculas», «Palabras completas», «Distinguir tildes».
   - Estado (`aria-live="polite"`): «3 de 120», «Sin resultados», «Buscando… 1.234 de 5.000 páginas» con `<progress>` y botón «Detener», «Más de 100.000 resultados; se muestran los primeros» si `truncated`.
   - Botón «Cerrar búsqueda».
3. `src/ui/viewer/SearchHighlights.tsx` (en `PageView`, debajo de la capa de texto y por encima del lienzo, `pointer-events: none`): si la página tiene coincidencias y su capa de texto está registrada, crea un `Range` por coincidencia (inicio en `textDivs[start.item].firstChild` + `offset`, fin en `textDivs[end.item].firstChild` + `offset`; si `end.offset === 0` y `end.item > start.item`, termina al final del ítem anterior) y pinta un `div` por rectángulo (posición relativa al contenedor de la página). Clase `hit` (amarillo 40 % opaco) y `hit-current` (naranja). Recalcula cuando cambian las coincidencias, la capa registrada, el zoom o la rotación. Si es la coincidencia actual y `revealSeq` cambió desde la última vez, llama a `goToPage(page, { yFraction: max(0, top/altoPágina - 0.3) })` (queda a un tercio de la pantalla).
   Si la página de la coincidencia actual no está montada, `nextMatch` hace primero `goToPage(page)`; al montarse, la revelación se completa.
4. Atajos: `find` `['Mod+F']` (abre o enfoca y selecciona el texto; añádelo a `ALLOW_IN_EDITABLE`), `find-next` `['F3']`, `find-prev` `['Shift+F3']`.
5. Mensajes: `search` «Buscar», `searchInput` «Buscar en el documento», `searchPlaceholder` «Buscar…», `matchCase`, `wholeWord`, `matchDiacritics` «Distinguir tildes», `prevMatch` «Resultado anterior», `nextMatch` «Resultado siguiente», `matchCounter(i, n)` «i de n», `noMatches` «Sin resultados», `searching(done, total)` «Buscando… done de total páginas», `stopSearch` «Detener», `truncatedMatches`, `closeSearch` «Cerrar búsqueda». Números con `toLocaleString('es-ES')`.
6. Tests: `tests/unit/search-actions.test.ts` (fuente falsa), `tests/ui/search-bar.test.tsx`, `tests/e2e/search.spec.ts`.

## Criterios de aceptación
- [ ] (T) `setQuery` tres veces en 100 ms lanza **una** sesión; cambiar una opción cancela la sesión anterior y lanza otra; `closeSearch` cancela y vacía las coincidencias.
- [ ] (T) `nextMatch` con coincidencias en p2 (1), p4 (2): actual p2#0 → p4#0 → p4#1 → p2#0 (vuelta); `prevMatch` desde p2#0 → p4#1.
- [ ] (T) UI: `Ctrl+F` enfoca el campo; Intro llama a `nextMatch`; Mayús+Intro a `prevMatch`; Esc cierra; los botones de opción tienen `aria-pressed` y `title`.
- [ ] E2E `basic-5.pdf`: buscar `busqueda` → «1 de 5» y 5 resaltados en total en las páginas montadas; la página 2 queda visible y su resaltado actual cubre la palabra «búsqueda» (el rectángulo `.hit-current` interseca el rectángulo de la selección de esa palabra); activar «Palabras completas» → «1 de 4».
- [ ] E2E `pages-5000.pdf`: buscar `aguja` desde la página 1 → aparece «1 de 2» y la página 1234 visible en < 3 s; F3 → página 4999; durante la búsqueda la interfaz responde (`scroll` del visor y escribir en el campo de página funcionan) y no hay *long tasks* > 100 ms (anota la máxima).
- [ ] E2E: buscar con zoom 200 % y vista girada: los resaltados siguen sobre el texto (captura en el Registro).
- [ ] E2E: «Detener» durante una búsqueda en `pages-100000.pdf` → el estado deja de cambiar y muestra los resultados encontrados hasta ese momento.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Panel con la lista de resultados (importante, no imprescindible: queda para la iteración 4 con [[PDF-049-recientes-y-pestanas]] u otra ficha que cree el líder). Buscar en varios PDFs.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
