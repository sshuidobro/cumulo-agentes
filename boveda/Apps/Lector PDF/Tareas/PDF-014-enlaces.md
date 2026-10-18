---
tipo: tarea
id: PDF-014
titulo: Enlaces internos y externos, destinos e historial atrás/adelante
app: pdf
estado: en-revision
depende_de: [PDF-012, PDF-003]
intentos: 0
skills: [stack-typescript-react, stack-tauri, formatos-ofimatica, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, ui, enlaces, seguridad]
---

# PDF-014 · Enlaces, destinos e historial

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
Los enlaces del PDF funcionan: los internos llevan a la página y posición del destino (con su zoom si lo indica), los externos (`http`, `https`, `mailto`) piden confirmación antes de abrirse en el navegador del sistema, y las acciones peligrosas (JavaScript, Launch, URLs raras) se bloquean con un aviso. Alt+← / Alt+→ vuelven a la vista anterior/siguiente. La resolución de destinos queda lista para el índice (PDF-016).

## Contexto
- Leer: `src/state/navigation.ts`, `src/ui/viewer/PageView.tsx`, `src/state/view-actions.ts`, `packages/platform/src/types.ts` (`openExternalUrl`), skill `stack-tauri` (sección Seguridad).
- pdf.js `page.getAnnotations({ intent: 'display' })`: los `Link` traen `rect` (puntos PDF), `url` (solo si pdf.js la considera válida), `unsafeUrl` (cruda), `dest` (`string` nombrado o array explícito), `action` (acciones con nombre: `NextPage`, `PrevPage`, `FirstPage`, `LastPage`, `GoBack`, `GoForward`). Los nombres PDF llegan como `{ name: 'XYZ' }`.
- `doc.getDestination(name)` → array o `null`; `doc.getPageIndex({ num, gen })` → índice 0-based. `viewport.convertToViewportPoint(x, y)` y `convertToViewportRectangle(rect)` pasan de puntos PDF a px.
- Fixture `links.pdf` (PDF-003), enlaces (a)…(h).

## Qué hay que hacer
1. `src/core/links.ts`:
   ```ts
   export type PdfDest = string | readonly unknown[];
   export type NamedAction = 'next-page' | 'prev-page' | 'first-page' | 'last-page' | 'back' | 'forward';
   export type LinkTarget =
     | { readonly kind: 'internal'; readonly dest: PdfDest }
     | { readonly kind: 'action'; readonly action: NamedAction }
     | { readonly kind: 'external'; readonly url: string }
     | { readonly kind: 'blocked'; readonly reason: 'unsafe-url' | 'unsupported' };
   export function classifyUrl(url: string): 'web' | 'mail' | 'blocked'; // http/https → web; mailto → mail; resto (javascript:, file:, data:, vbscript:, sin protocolo válido) → blocked
   export function linkTargetFromAnnotation(a: { readonly url?: unknown; readonly unsafeUrl?: unknown; readonly dest?: unknown; readonly action?: unknown }): LinkTarget;
     // url string → classifyUrl(url) !== 'blocked' ? external : blocked unsafe-url; unsafeUrl sin url → blocked unsafe-url;
     // dest string o array → internal; action conocida → action (NextPage→next-page, …); resto → blocked unsupported
   ```
2. `src/core/dest.ts`:
   ```ts
   export type DestKind = 'XYZ' | 'Fit' | 'FitH' | 'FitV' | 'FitR' | 'FitB' | 'FitBH' | 'FitBV';
   export interface ParsedDest { readonly pageRef: unknown; readonly kind: DestKind; readonly left: number | null; readonly top: number | null; readonly zoom: number | null }
   export function parseExplicitDest(dest: readonly unknown[]): ParsedDest | null; // XYZ: [ref, XYZ, left, top, zoom]; FitH/FitBH: [ref, k, top]; FitV/FitBV: [ref, k, left]; FitR: [ref, k, left, bottom, right, top] → left y top; valores no numéricos → null; tipo desconocido → null
   export function destZoomMode(d: ParsedDest): ZoomMode | null; // XYZ con zoom > 0 → custom; Fit/FitB → fit-page; FitH/FitBH → fit-width; resto → null
   ```
3. `src/engine/links.ts`: `export interface PageLink { readonly rect: readonly [number, number, number, number]; readonly target: LinkTarget }` y `export async function getPageLinks(page: PDFPageProxy): Promise<PageLink[]>`.
   `src/engine/dest.ts`: `export interface ResolvedDest { readonly pageIndex: number; readonly yFraction: number | null; readonly xFraction: number | null; readonly zoom: ZoomMode | null }` y `export async function resolveDest(doc: PDFDocumentProxy, dest: PdfDest): Promise<ResolvedDest | null>` (nombrado → `getDestination`; `pageRef` objeto → `getPageIndex`; entero → ese índice; con `top`/`left` → `convertToViewportPoint` en un viewport de escala 1 con la rotación propia de la página → fracciones; errores → `null`).
4. `src/state/history.ts`: pilas atrás/adelante de `{ page: number; yFraction: number }` (máx. 50). `export function navigateToDest(dest: PdfDest): Promise<void>` (guarda la posición actual en «atrás», vacía «adelante», resuelve, aplica `zoom` si no es `null` con `setZoomMode` y llama a `goToPage(page, { yFraction, xFraction })`; destino irresoluble → aviso `msg.linkBroken` en una notificación). `goBack()`, `goForward()`, `canGoBack()`, `canGoForward()` en el store (`historyState: { canBack: boolean; canForward: boolean }`). `runNamedAction(a)`.
5. `src/ui/kit/Dialog.tsx`: `{ open, title, children, actions, onClose }` → `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, foco al primer botón al abrir, Tab atrapado dentro, Esc cierra, el foco vuelve al elemento anterior al cerrar. `src/ui/kit/Notice.tsx`: aviso temporal `role="status"` que desaparece a los 4 s (para mensajes como «enlace roto»).
6. `src/ui/viewer/LinkLayer.tsx` (en `PageView`, por encima de la capa de texto): `getPageLinks` al montar; un elemento por enlace en su rectángulo (`convertToViewportRectangle` normalizado) con `z-index` sobre el texto:
   - `internal`/`action`: `<a href="#" aria-label={msg.internalLink}>`; clic → `navigateToDest`/`runNamedAction`.
   - `external`: `<a href={url} title={url} rel="noopener noreferrer">`; clic → `preventDefault` y `Dialog` «Abrir enlace externo» con texto `msg.confirmExternal(url)` y botones «Abrir» / «Cancelar»; «Abrir» → `platform.openExternalUrl(url)` (si devuelve `err`, `Notice` con el mensaje).
   - `blocked`: `<span>` con `title={msg.linkBlocked}` y cursor `not-allowed`; clic no hace nada.
7. Atajos: `back` `['Alt+ArrowLeft']`, `forward` `['Alt+ArrowRight']`; botones «Vista anterior»/«Vista siguiente» en la barra (deshabilitados según `historyState`).
8. Mensajes: `internalLink` «Ir al destino del enlace», `confirmExternalTitle` «Abrir enlace externo», `confirmExternal(url)` «Se abrirá «url» en el navegador. ¿Quieres continuar?», `openLink` «Abrir», `linkBlocked` «Este enlace ejecuta una acción no permitida y se ha bloqueado por seguridad.», `linkBroken` «El destino de este enlace no existe en el documento.», `back` «Vista anterior», `forward` «Vista siguiente».
9. Tests: `tests/unit/links.test.ts`, `tests/unit/dest.test.ts`, `tests/unit/engine-links.test.ts` (motor real con `links.pdf` y `outline.pdf`), `tests/ui/link-layer.test.tsx`, `tests/ui/dialog.test.tsx`, `tests/e2e/links.spec.ts`.

## Criterios de aceptación
- [ ] (T) `classifyUrl`: `https://a.b` web, `mailto:x@y.z` mail, `javascript:alert(1)`, `JAVASCRIPT:x`, `file:///etc`, `data:text/html,x`, `vbscript:x`, `//a.b` → blocked.
- [ ] (T) `parseExplicitDest([{num:5,gen:0},{name:'XYZ'},72,500,0])` → `{ kind: 'XYZ', left: 72, top: 500, zoom: 0 }`; `[{...},{name:'FitH'},792]` → `top 792`; `[{...},{name:'Raro'}]` → `null`; `destZoomMode` de XYZ con zoom 0 → `null`, con 1.5 → custom 1.5.
- [ ] (T) Motor con `links.pdf`: los 8 enlaces se clasifican así: (a) internal, (b) internal `'destino-final'`, (c) internal, (d) external `https://example.org/ruta?x=1`, (e) external mailto, (f) blocked, (g) blocked, (h) blocked. `resolveDest` de (a) → `pageIndex 2`, `yFraction ≈ 0.495` (`(792-400)/792`); de (b) → `pageIndex 4`, zoom `fit-page`.
- [ ] (T) Historial: navegar a 3 destinos y `goBack()` ×2 → posición del 1.º destino; `goForward()` → 2.º; un `navigateToDest` nuevo vacía «adelante».
- [ ] (T) `Dialog`: Esc cierra y devuelve el foco al botón que lo abrió; Tab no sale del diálogo.
- [ ] E2E `links.pdf`: clic en (a) → «Página 3 de 5» visible; `Alt+←` → vuelve a la p1; clic en (d) → diálogo con la URL; «Cancelar» → `window.open` no se llama (reemplázalo con `page.addInitScript`); «Abrir» → se llama con la URL y `'noopener,noreferrer'`; clic en (f), (g), (h) → ni diálogo ni navegación.
- [ ] Seguridad: ninguna URL del PDF se asigna a `location`/`window.open` sin pasar por `classifyUrl` y el diálogo (revisión del revisor con `grep` de `window.open` y `location`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Índice (PDF-016). Crear o editar enlaces (iteración 6). Adjuntos y acciones de formulario.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados (apps/lector-pdf): nuevos `src/core/links.ts`, `src/core/dest.ts`, `src/engine/links.ts`, `src/engine/dest.ts`, `src/state/history.ts`, `src/state/notice.ts`, `src/ui/kit/Dialog.tsx`, `src/ui/kit/Notice.tsx` (+ `.module.css`), `src/ui/viewer/LinkLayer.tsx` (+ `.module.css`); editados `src/state/viewer-store.ts` (campos `historyState` y `notice`), `src/ui/viewer/PageView.tsx` (monta `LinkLayer`), `src/ui/App.tsx` (atajos atrás/adelante y `Notice`), `src/ui/toolbar/MainToolbar.tsx` (botones «Vista anterior»/«Vista siguiente»), `src/ui/messages.ts`, `src/ui/shortcuts.ts` (`back` Alt+← y `forward` Alt+→). Tests nuevos: `tests/unit/links.test.ts`, `tests/unit/dest.test.ts`, `tests/unit/engine-links.test.ts`, `tests/unit/history.test.ts`, `tests/ui/link-layer.test.tsx`, `tests/ui/dialog.test.tsx`, `tests/ui/notice.test.tsx`, `tests/e2e/links.spec.ts`.
- Qué he hecho: clasificación de URLs y destinos (núcleo puro), resolución de destinos con pdf.js, historial atrás/adelante (máx. 50, se vacía al abrir otro documento), capa de enlaces sobre el texto con confirmación para URLs externas y bloqueo de lo no permitido, diálogo accesible (foco, Tab atrapado, Esc, retorno de foco) y aviso temporal de 4 s. Reutilizo `currentYFraction` y `setCurrentYFraction` que PDF-019 ha añadido al store; no he tocado sus ficheros.
- Comandos ejecutados y resultado: `pnpm typecheck` OK (app). ESLint sobre todos mis ficheros: 0 avisos. `vitest --project lector-pdf --coverage --coverage.reportsDirectory=<scratchpad>` OK: 79 ficheros, 1032 tests en verde con la cobertura de mis ficheros de `core/` por encima del 80 %. `pnpm --filter lector-pdf e2e`: 52 pasan y 1 falla (`viewer.spec.ts:88`, ver abajo). `links.spec.ts`: 4/4 en verde.
- Dudas o cosas que no he podido hacer:
  1. pdf.js 6.4 no tiene `convertToViewportRectangle` (la ficha lo pedía): convierto las cuatro esquinas con `convertToViewportPoint` y tomo la envolvente.
  2. `parseExplicitDest` acepta `null` en las coordenadas (la interfaz es `number | null`); cualquier otro valor no numérico da `null`.
  3. Añadido un mensaje no listado en la ficha: `msg.openLinkFailed` («No se ha podido abrir el enlace en el navegador.») para el aviso si `openExternalUrl` falla.
  4. Los enlaces externos también interceptan el clic de rueda (`onAuxClick`) para que no abran sin confirmación.
  5. Los botones atrás/adelante reutilizan los iconos de página (`IconPrevPage`/`IconNextPage`); no hay iconos propios de historial.
  6. No he usado `outline.pdf` en los tests del motor: la ficha lo menciona pero ningún criterio lo exige; queda para PDF-016.
  7. Fallo ajeno: `tests/e2e/viewer.spec.ts:88` («el visor es enfocable con Tab») falla de forma determinista: la barra tiene una parada de tabulación más (el botón de la barra lateral de PDF-015, en curso) y el test solo admite 12 pulsaciones. Mis botones atrás/adelante están deshabilitados al inicio y no añaden paradas. No he tocado el test.
  8. Fallo ajeno: `pnpm lint` global falla en `tests/e2e/text-qa.spec.ts` (PDF-013, en curso); mis ficheros pasan.
  9. El puerto 4173 lo usaba otro agente durante mi primera ejecución de e2e; la repetí cuando quedó libre.
  10. No he hecho commit (la orden era no tocar git mientras trabajan otros en el árbol). Pendiente de que el líder decida el commit de la ficha.
