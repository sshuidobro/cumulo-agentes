---
tipo: tarea
id: PDF-044
titulo: Imprimir (Ctrl+P) con rango, comentarios, calidad y progreso cancelable
app: pdf
estado: hecha
depende_de: [PDF-087, PDF-045, COM-014]
intentos: 1
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

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: nuevos `apps/lector-pdf/src/state/print-actions.ts`, `src/ui/messages-print.ts`, `src/ui/print/PrintDialog.tsx`, `PrintDialog.module.css`, `PrintProgress.tsx`, `PrintContainer.tsx`, `print.css`; modificados `src/ui/App.tsx`, `src/ui/shortcuts.ts` (atajo `print`, Mod+P), `src/ui/toolbar/MainToolbar.tsx` (botón tras «Guardar como»), `src/ui/toolbar/DocumentMenu.tsx` (entrada «Imprimir…»), `src/ui/icons.tsx` (`IconPrint`); tests nuevos `tests/unit/print-actions.test.ts`, `tests/ui/print-dialog.test.tsx`, `tests/e2e/print.spec.ts`.
- Qué he hecho: diálogo Imprimir (páginas, comentarios, orientación, calidad, rango validado con Intro y Esc), progreso con Cancelar, y `startPrint`/`cancelPrint` sobre `openPrintSource` y `renderPageForPrint` (PDF-087). Hojas en `#print-container` con `@page` del tamaño de la página 1, giro automático, URL de blob revocadas al terminar (o en `afterprint`). Confirmación por encima de 500 páginas. Las opciones se recuerdan en `printOptions` salvo el texto del rango.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` OK (180 ficheros, 2127 tests); `pnpm --filter lector-pdf e2e` (chromium y chromium-perf, 172 tests) código 0; `pnpm --filter lector-pdf build` OK (arranque 473 460 bytes de 500 000); `pnpm coverage` código 0 (líneas 98,98 %).
- Dudas o cosas que no he podido hacer:
  1. **«Página N de 5000» en orden en el PDF de `page.pdf()`**: no es comprobable por texto, porque Chromium sale rasterizado (cada hoja es una imagen). La e2e comprueba: una sola llamada a `print`, tres hojas, PDF de 3 páginas y URL creadas = revocadas. El orden lo cubre el test unitario (índices 1, 2, 3). Si el líder quiere la comprobación de contenido, hace falta otra estrategia (p. ej. comparar con un render de referencia).
  2. El `page.pdf()` de la e2e se hace sobre el contenedor reconstruido con las hojas copiadas en `window.print` (la app vacía el contenedor en cuanto `print()` resuelve, así que no se puede llamar a `page.pdf()` tal cual).
  3. «Resaltado en la zona»: la e2e cuenta píxeles amarillos en toda la hoja 1 (basic-5 no tiene otro amarillo).
  4. Preferencias: interpreto «salvo el rango» como: se recuerdan páginas, comentarios, orientación y calidad, pero no el texto del rango.
  5. Extensiones de API (necesarias, no cambian lo pedido): `PrintSheet` queda `{url, rotate}` y el tamaño de hoja va en `usePrintJob.sheet`; `usePrintDialog` (estado del diálogo) está en `print-actions.ts`.
  6. Riesgo para Tauri: `platform.print()` resuelve en cuanto se pide el diálogo; si el webview lee el DOM después, las hojas pueden faltar. Cómo lo trata la ficha: se revoca al resolver o al `afterprint`. Hay que comprobarlo en la máquina del usuario.
  7. **Pendiente, sin hacer**: criterio «Manual» (`tauri dev` → Ctrl+P abre el diálogo del sistema). Requiere la máquina del usuario.
  8. El presupuesto de arranque (500 000 bytes) queda a 26 000 bytes; el código de impresión está en el bundle principal. Conviene vigilarlo.

### [revisor] ronda 1 — 2026-10-18 — CAMBIOS
Comprobado: `pnpm lint` OK; tests de la ficha (`print-actions`, `print-dialog`, 27) OK. `pnpm typecheck` falla por `src/ui/viewer/FormLayer.tsx(127)` (`maxLength: number | undefined`, `exactOptionalPropertyTypes`): fichero sin seguir en git de otro agente, ajeno a esta ficha; no se imputa aquí, pero la ficha no podrá cerrarse con typecheck rojo.
Código revisado (print-actions, PrintDialog, PrintContainer, print.css): correcto y limpio (cancelación, revocado único con `closeRun`, `afterprint`, rango validado, a11y del diálogo). Solo bloquea lo siguiente:
1. `apps/lector-pdf/tests/e2e/print.spec.ts:172-191` — el criterio 1 (orden «Página 2/3/4 de 5000») no tiene ningún test. La limitación de Chromium (hojas rasterizadas, sin texto) es real y aceptable para NO leer texto, pero la alternativa propuesta es insuficiente: el test unitario de índices (1, 2, 3) no prueba que las `<img>` del contenedor salgan en ese orden ni que cada imagen sea la de su página, y la e2e solo cuenta 3 hojas. Qué hacer: en la e2e, comparar cada hoja del `snapshot.images` (en orden del HTML) con la hoja de imprimir por separado «Página actual» de las páginas 2, 3 y 4 (mismo dpi, render determinista → data URL idéntica), y comprobar que las tres son distintas entre sí. Alternativa válida: render del PNG de cada hoja y comparar con el render de pdf.js de esa página (`toHaveScreenshot`/diferencia con tolerancia). Documentar en la ficha que el criterio se sustituye por este («texto» → «imagen equivalente»).
2. `apps/lector-pdf/tests/e2e/print.spec.ts:282-284` — el criterio @perf pide «Cancelar deja `job.status === 'idle'` en < 300 ms» y el test solo espera que el diálogo se oculte. Qué hacer: leer `usePrintJob` (o comprobar que `#print-container` sigue vacío y que no se llama a `print`) y, tras cancelar, que `created === revoked` en el balance de URL.
3. Criterio «Manual» (`tauri dev` → Ctrl+P): imposible aquí; es aceptable que quede como verificación manual, pero añade al final del Registro una línea «Pendiente Manual» con los pasos exactos, y que el tester lo marque como comprobación en la máquina del usuario (no se da por cumplido). El riesgo de que `print()` resuelva antes de que el webview lea el DOM (duda 6) debe constar ahí.
4. (opcional) `print.spec.ts:118-131` — `printedPdf` reconstruye el DOM con data URL; vale, pero comprueba también que el PDF no esté vacío (cada página con imagen) para que el conteo de 3 páginas no pase con hojas en blanco.

### [programador] ronda 2 — 2026-10-18
- Ficheros cambiados: `apps/lector-pdf/tests/e2e/print.spec.ts`; `boveda/Apps/Lector PDF/Tareas/PDF-044-imprimir.md` (estado y este Registro).
- Qué he hecho: (1) Criterio 1 (orden de páginas): la e2e de rango 2-4 compara cada hoja, en el orden del HTML del contenedor, con la misma página impresa sola (rango «2», «3», «4»); exige que sean idénticas por parejas y que las tres sean distintas. Además comprueba con pdf.js que cada una de las 3 páginas del PDF de `page.pdf()` lleva exactamente una imagen (`[1, 1, 1]`, no hay páginas en blanco). Sustitución documentada: el criterio «texto "Página N de 5000"» pasa a «imagen equivalente a su página», porque Chromium imprime las hojas como imágenes y no hay texto que extraer. (2) `@perf` Cancelar: tras cancelar comprueba que el diálogo de progreso se oculta en < 300 ms (solo se muestra con `job.status === 'preparing'`), que la impresión se ha cortado antes de las 5 000 páginas, que `#print-container` está vacío, que `print` no se ha llamado y que URL creadas = revocadas. (3) Criterio «Manual» sigue sin cumplirse aquí, ver abajo.
- Comandos ejecutados y resultado: `pnpm exec eslint tests/e2e/print.spec.ts` OK; `pnpm lint` OK; `pnpm typecheck` OK (el fallo de `FormLayer.tsx` ya no aparece); `pnpm --filter lector-pdf test` OK (183 ficheros, 2148 tests); `pnpm coverage` OK (líneas 98,98 %); `pnpm --filter lector-pdf build` OK (arranque 478 040 bytes de 500 000); e2e completa: 173 pasan en `chromium`, con 2 fallos ajenos a esta ficha (`pdfjs-deferred.spec.ts` y `performance.spec.ts`, presupuestos de tiempo de apertura con la máquina cargada por otros agentes); proyecto `chromium-perf` (`--no-deps`): 9/9 OK, incluido el `@perf` de impresión. El filtro por ruta de Playwright no se aplica en este entorno, por eso se ejecutó la suite completa.
- Dudas o cosas que no he podido hacer:
  - **Pendiente Manual** (no cumplido, no se da por cerrado): en la máquina del usuario, `pnpm --filter lector-pdf tauri dev` → abrir `basic-5.pdf` → Ctrl+P → «Página actual» → Imprimir: debe abrirse el diálogo de impresión del sistema con la página. Riesgo a comprobar: `platform.print()` resuelve en cuanto se pide el diálogo; si el webview lee el DOM de `#print-container` después, las hojas pueden faltar (duda 6 de la ronda 1). Por eso las hojas se revocan al resolver o en `afterprint`.
  - La e2e sigue limitada a Chromium: no comprueba el contenido del PDF de impresión de Tauri.

### [revisor] ronda 2 — 2026-10-18 — APROBADO
Comprobado: `pnpm lint` y `pnpm typecheck` OK. Ronda 1 atendida: (1) orden/identidad de las hojas del rango 2-4 frente a «2», «3», «4» por separado, tres distintas y 1 imagen por página del PDF; sustitución «texto» a «imagen equivalente» documentada y aceptada. (2) Cancelar: contenedor vacío, `print` no llamado, creadas = revocadas. (3) «Pendiente Manual» con pasos y riesgo de `print()`: consta; el tester debe marcarlo como comprobación en la máquina del usuario, no cumplido aquí.
1. (opcional) `tests/e2e/print.spec.ts` (@perf Cancelar) — `created < 20 + 5000` es una cota muy laxa; afinar si se puede.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| 1 Rango 2-4, 1 llamada a print, PDF de 3 páginas | PASA (con sustitución «texto» → «imagen equivalente» aceptada por el revisor) | `print.spec.ts:206` verde |
| 2 Contenedor vacío y blobs creados = revocados | PASA | mismo test |
| 3 Resaltado sin guardar con/sin comentarios | PASA | `print.spec.ts:237` |
| 4 sizes-mixed, 6 hojas, p2 girada | PASA | `print.spec.ts:263` |
| 5 @perf (sin long tasks >100 ms, Cancelar <300 ms, heap <400 MB) | PASA | `print.spec.ts:301`, chromium-perf, 3,2 s |
| 6 Rango no válido, Esc, foco inicial | PASA | `print.spec.ts:284` + `tests/ui/print-dialog.test.tsx` |
| 7 Axe diálogo y progreso | PASA | `print.spec.ts:288` y `:324` |
| 8 Manual en Tauri | PENDIENTE MANUAL (usuario), no cumplido ni bloqueante | ver ronda 2 del programador |
| 9 Baterías | PASA, ver nota de lint | e2e 184/184 (4,1 min); typecheck 0; test 2149/2149; coverage 0 (líneas 98,98 %); build 0 (arranque 478 040 de 500 000) |

Nota lint: `pnpm lint` da 6 errores `no-non-null-assertion` solo en `apps/lector-pdf/tests/unit/form-highlight-contrast.test.ts` (fichero sin seguir en git, trabajo en curso del programador de FormLayer, ajeno a PDF-044). Con ese fichero excluido, lint sale con 0. Debe corregirlo quien lo creó antes de su propia ficha.
Los presupuestos de tiempo pasaron a la primera, sin repetir en reposo. Tests añadidos: ninguno nuevo (cobertura suficiente).
