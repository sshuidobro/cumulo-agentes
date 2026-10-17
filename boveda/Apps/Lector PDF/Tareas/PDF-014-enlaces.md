---
tipo: tarea
id: PDF-014
titulo: Enlaces internos y externos, destinos e historial atrás/adelante
app: pdf
estado: pendiente
depende_de: [PDF-012, PDF-003]
intentos: 0
skills: [stack-typescript-react, stack-tauri, formatos-ofimatica, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
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
