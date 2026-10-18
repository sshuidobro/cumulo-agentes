---
tipo: tarea
id: PDF-044
titulo: Imprimir (Ctrl+P) con rango, comentarios, calidad y progreso cancelable
app: pdf
estado: pendiente
depende_de: [PDF-087, PDF-045, COM-014]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-18
tags: [tarea, pdf, iteracion-3, impresion, ui]
---

# PDF-044 · Imprimir (Ctrl+P) con rango, comentarios, calidad y progreso cancelable

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Decisiones: [[ADR-0021-impresion]] · Paridad: [[Paridad Adobe Acrobat]] (área 7)

## Objetivo
Ctrl+P (o el botón «Imprimir» y «Más acciones › Imprimir…») abre un diálogo con páginas (todas, actual, rango), «Imprimir comentarios», «Orientación automática» y «Alta calidad»; al aceptar prepara las páginas con progreso y Cancelar y abre el diálogo de impresión del sistema. Imprime lo que se guardaría (anotaciones y formularios sin guardar incluidos) y funciona con documentos de miles de páginas.

## Contexto
- Leer: `src/core/print/*`, `src/engine/print-render.ts`, `src/state/print-source.ts` (PDF-087), `src/ui/kit/Dialog.tsx`, `src/ui/toolbar/DocumentMenu.tsx` (PDF-045), `src/ui/toolbar/MainToolbar.tsx`, `src/ui/shortcuts.ts`, `src/ui/App.tsx`, `packages/platform/src/types.ts` (`print`, COM-014), `src/ui/viewer/Viewer.module.css` (para saber qué ocultar al imprimir).
- Textos en `src/ui/messages-print.ts` (`printMsg`).

## Qué hay que hacer
1. `src/state/print-actions.ts`:
```ts
export interface PrintOptions { readonly pages: 'all' | 'current' | 'range'; readonly range: string; readonly withComments: boolean; readonly autoRotate: boolean; readonly highQuality: boolean }
export type PrintJobState = { readonly status: 'idle' } | { readonly status: 'preparing'; readonly done: number; readonly total: number } | { readonly status: 'ready' };
export const usePrintJob: UseBoundStore<StoreApi<{ readonly job: PrintJobState; readonly sheets: readonly PrintSheet[]; readonly pageCss: string | null }>>;
export interface PrintSheet { readonly url: string; readonly rotate: 0 | 90 }
export async function startPrint(o: PrintOptions): Promise<'printed' | 'cancelled' | 'failed'>;
export function cancelPrint(): void;
```
   `startPrint`: índices con `parsePageRange` (o todas / la actual); > 500 páginas → `askChoice` «Vas a imprimir N páginas. Prepararlas puede tardar varios minutos.» [Imprimir, Cancelar]; `openPrintSource()`; si `unsavedIncluded === false` y hay cambios → aviso `printMsg.unsavedNotIncluded`; `sheetFor` con la primera página; por cada índice, `renderPageForPrint` (cede el hilo entre páginas, actualiza `done`), `URL.createObjectURL(blob)`, `planPage`; `pageCss` = `@page { size: <w>pt <h>pt; margin: 0 }`; estado `ready`; `await platform.print()`; al terminar (o en `afterprint`) revoca las URL, vacía `sheets` y `dispose()` del origen. Cancelar en cualquier momento revoca lo creado.
2. `src/ui/print/PrintDialog.tsx`: diálogo «Imprimir» con radio Páginas (Todas / Página actual (n) / Páginas: campo con ejemplo «1-3, 5»), casillas «Imprimir comentarios» (marcada), «Orientación automática» (marcada), «Alta calidad (más lento)»; texto «Se imprimirán N páginas.» que se actualiza; rango no válido → mensaje bajo el campo «Escribe páginas entre 1 y N, por ejemplo 1-3, 5» y botón Imprimir deshabilitado. Preferencias recordadas (`printOptions`) salvo el rango.
3. `src/ui/print/PrintProgress.tsx`: diálogo con `<progress>` «Preparando página n de N…» y «Cancelar».
4. `src/ui/print/PrintContainer.tsx` + `print.css` (importado en `main.tsx` o `App.tsx`): portal a `document.body` con `<div id="print-container">` y una `div.sheet` por hoja (`width`/`height` en pt de la hoja, `break-after: page`) con su `<img>` (`object-fit: contain`, `rotate(90deg)` si toca). `<style>` con `pageCss`. `@media print`: `body > *:not(#print-container) { display: none !important }`; `@media screen`: `#print-container { display: none }`.
5. Atajo `'print'` `['Mod+P']` («Imprimir»), en `VIEW_SHORTCUTS`; botón `IconPrint` en `MainToolbar` tras «Guardar como»; entrada en `DocumentMenu`.
6. Tests: UI de diálogo y acciones (jsdom, `renderPageForPrint` simulado) y E2E `tests/e2e/print.spec.ts` (sustituir `window.print` con `page.addInitScript` por una función que incrementa `window.__printCount`; después `page.pdf()` con `preferCSSPageSize: true`).

## Criterios de aceptación
- [ ] E2E `pages-5000.pdf`: Ctrl+P → rango «2-4» → Imprimir → `__printCount === 1` y `page.pdf()` da un PDF de **3** páginas cuyo texto (pdf.js en Node) contiene «Página 2 de 5000», «Página 3 de 5000», «Página 4 de 5000» en orden.
- [ ] E2E: tras imprimir, `#print-container` está vacío y no quedan URL `blob:` vivas (contador de `createObjectURL`/`revokeObjectURL` en la página igual).
- [ ] E2E `basic-5.pdf` con un resaltado **sin guardar** en la p1: «Página actual» con «Imprimir comentarios» → el PDF de impresión tiene píxeles amarillos en la zona del resaltado (render del PDF de `page.pdf()` con pdf.js en Node o comprobación del PNG de la hoja); desmarcando «Imprimir comentarios» → no los tiene.
- [ ] E2E `sizes-mixed.pdf`, «Todas» con orientación automática: 6 hojas del tamaño de la p1; la hoja de la p2 (Carta horizontal) lleva la imagen girada (`rotate: 90`).
- [ ] E2E `@perf` (`pages-5000.pdf`, 20 páginas): ninguna *long task* > 100 ms durante la preparación; «Cancelar» a mitad deja `job.status === 'idle'` en < 300 ms; heap tras imprimir < 400 MB.
- [ ] Rango no válido («0», «1-9999» en un documento de 5) → botón deshabilitado y mensaje; Esc cierra el diálogo; foco inicial en «Imprimir».
- [ ] Axe sin incidencias `serious`/`critical` en el diálogo y en el de progreso.
- [ ] Manual (Registro): en la máquina del usuario, `tauri dev` → Ctrl+P abre el diálogo del sistema (lista para el Manual).
- [ ] `pnpm --filter lector-pdf e2e` completo con código 0; `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `pnpm --filter lector-pdf build` con código 0.

## Fuera de alcance
- Varias páginas por hoja, folleto, póster, dúplex, vista previa propia (iteración posterior). Respetar «no imprimir» del PDF (PDF-048).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
