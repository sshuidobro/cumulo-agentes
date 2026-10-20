---
tipo: tarea
id: PDF-129
titulo: Crear PDF desde imágenes - diálogo y guardado
app: pdf
estado: en-curso
depende_de: [PDF-056, PDF-128]
intentos: 0
skills: [stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-5, organizar, ui]
---

# PDF-129 · Crear PDF desde imágenes: diálogo y guardado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0035-organizar-en-la-app]] · Antes: [[PDF-056-pdf-desde-imagenes]], [[PDF-128-insertar-combinar-interfaz]] (usa `importFiles` de [[COM-019-importar-varios-ficheros]])

## Objetivo
Desde la pantalla de inicio o «Más acciones», «Crear PDF desde imágenes…» deja elegir varias imágenes, ordenarlas, elegir tamaño de página y margen, y guarda el PDF resultante y lo abre.

## Contexto
- Op `'images-to-pdf'` y tipos `ImageInput`, `PageSizeMode` (PDF-056).
- `src/core/signature/image-art.ts` → `isJpegBytes`; `src/core/pdf/image.ts` → `readJpegInfo`.
- **Patrón a copiar**: `src/state/combine-actions.ts` y `src/ui/organize/CombineDialog.tsx` (PDF-128); `src/ui/signature/image-art.ts` (decodificar una imagen del usuario en el navegador).
- `services().platform.importFiles`, `saveAs`; `src/state/document-actions.ts` → `openRequested`, `PDF_FILTERS`; `src/ui/kit/DocOpProgress.tsx`.
- `src/ui/open/EmptyState.tsx`, `src/ui/toolbar/DocumentMenu.tsx`, `src/ui/App.tsx`.

## Qué hay que hacer
1. `src/state/images-pdf-actions.ts`:
```ts
export const IMAGE_FILTERS: readonly FileFilter[];   // [{ name: 'Imágenes', extensions: ['jpg','jpeg','png','gif','webp','bmp'] }]
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;
export const MAX_IMAGES = 500;
export const MAX_IMAGE_PIXELS = 50_000_000;
export interface ImageItem { readonly id: string; readonly name: string; readonly bytes: Uint8Array; readonly previewUrl: string }
export const useImagesDialog: UseBoundStore<StoreApi<{ readonly open: boolean; readonly items: readonly ImageItem[]; readonly pageSize: PageSizeMode; readonly margin: 0 | 18 | 36 }>>;
export function openImagesDialog(): Promise<void>;   // abre y lanza addImages()
export async function addImages(): Promise<void>;
export function moveImage(id: string, delta: -1 | 1): void;
export function removeImage(id: string): void;       // revoca su previewUrl
export async function createPdfFromImages(): Promise<'saved' | 'downloaded' | 'cancelled' | 'failed'>;
```
   - Preferencias recordadas (`pageSize`, `margin`) con `platform.prefs` bajo `images-pdf-options` (por defecto `a4` y 18).
   - Al crear: cada JPEG válido (`isJpegBytes` + `readJpegInfo` no nulo) va como `{ kind: 'jpeg' }`; el resto se decodifica con `createImageBitmap(new Blob([bytes]))` y un `OffscreenCanvas` (o `canvas`) → `getImageData` → `{ kind: 'rgba' }`; más de `MAX_IMAGE_PIXELS` o fallo de decodificación → aviso `imagesMsg.cannotRead(nombre)` y se para sin crear nada. Se cede el hilo entre imágenes (`await` de `createImageBitmap` y `setTimeout(0)`).
   - Op `'images-to-pdf'` con progreso y cancelar (`useDocOpJob`) → `saveAs('<primera>.pdf', PDF_FILTERS, { kind: 'bytes', bytes })` → `'saved'` → `openRequested(file)`; `'downloaded'` → aviso.
   - Cerrar el diálogo revoca todas las `previewUrl`.
2. `src/ui/organize/ImagesDialog.tsx` (+ CSS, `lazy`): lista con miniatura (`<img alt="">` con `previewUrl`), nombre, «Subir», «Bajar», «Quitar» (Alt+↑/↓ como en Combinar); «Añadir imágenes…»; «Tamaño de página»: Ajustar a cada imagen / A4 / Carta; «Margen»: Sin margen / Pequeño / Normal (deshabilitado con «Ajustar»); «Crear PDF» deshabilitado sin imágenes.
3. Entradas: `EmptyState.tsx` → botón «Crear PDF desde imágenes…»; `DocumentMenu.tsx` → misma entrada.
4. `src/ui/messages-images.ts` (`imagesMsg`): `menuItem`, `title` «Crear PDF desde imágenes», `add`, `pageSize`, `fit` «Ajustar a cada imagen», `a4`, `letter` «Carta», `margin`, `none` «Sin margen», `small` «Pequeño», `normal` «Normal», `create` «Crear PDF», `cannotRead(name)` «No se puede leer la imagen “nombre”.», `tooMany` «Puedes añadir como mucho 500 imágenes.», `tooBig` «Cada imagen puede ocupar como mucho 50 MB.», `progress(done, total)` «Creando PDF: imagen X de Y…», `created(name)`.
5. Tests: `tests/unit/images-pdf-actions.test.ts` (decodificación simulada), `tests/ui/images-dialog.test.tsx`, `tests/e2e/images-pdf.spec.ts` (imágenes de prueba generadas en el propio test con `page.evaluate` y `canvas.toBlob`, o ficheros pequeños en `tests/e2e/assets/`).

## Criterios de aceptación
- [ ] E2E: crear desde 3 imágenes (2 JPEG, 1 PNG con transparencia) en A4 → se descarga un PDF de 3 páginas que la app abre; el orden es el de la lista tras «Bajar» la primera.
- [ ] E2E: un JPEG del lote sale con sus bytes intactos (la prueba busca la secuencia de bytes del JPEG dentro del PDF descargado).
- [ ] E2E: un fichero `.png` corrupto → aviso «No se puede leer la imagen “…”.» y no se descarga nada.
- [ ] Unit: más de 500 imágenes o una > 50 MB → aviso y nada añadido; cancelar a mitad → nada guardado; las `previewUrl` se revocan al cerrar (espía `URL.revokeObjectURL`).
- [ ] E2E `@perf`: crear desde 20 JPEG de ~2 MB sin *long tasks* > 100 ms.
- [ ] Teclado y accesibilidad: diálogo operable solo con teclado; axe sin violaciones; tema oscuro.
- [ ] `pnpm --filter lector-pdf bundle:check` dentro del presupuesto.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- HEIC y TIFF multipágina. Arrastrar imágenes a la ventana. Recortar o girar imágenes en el diálogo. OCR automático.

## Replanificación (líder, 2026-10-20) · paso 6: volver al presupuesto de arranque
Lo hecho en la ronda 1 (commit `3e809cc`) **se conserva**. El presupuesto **no** sube: [[ADR-0041-presupuesto-arranque-600kb]] lo fijó el usuario y, por encima, manda diferir código. Hay que bajar al menos 415 B. Objetivo: arranque ≤ 599 000 B (1 KB de margen).

6a. **Una sola carga diferida del diálogo.** En `src/state/images-dialog-store.ts` añadir:
```ts
/** Carga las acciones y abre el diálogo (un único `import()` para la pantalla de inicio y «Más acciones»). */
export function requestImagesDialog(): void {
  void import('./images-pdf-actions').then((a) => a.openImagesDialog());
}
```
En `EmptyState.tsx` y `DocumentMenu.tsx`, sustituir las dos lambdas `void import('../../state/images-pdf-actions')…` por `requestImagesDialog` (`onClick={requestImagesDialog}` y `onSelect: requestImagesDialog`). Así Vite genera un solo envoltorio `__vitePreload` en lugar de dos.

6b. **Progreso de operaciones en diferido.** `DocOpJobProgress` (con `DocOpProgress` y su CSS) solo se ve durante una operación y hoy entra en el arranque. En `src/ui/App.tsx`:
- Quitar `import { DocOpJobProgress } from './kit/DocOpProgress';`.
- Añadir `const DocOpJobProgress = lazy(() => import('./kit/DocOpProgress').then((m) => ({ default: m.DocOpJobProgress })));`, junto a los demás `lazy`.
- Añadir `import { useDocOpJob } from '../state/extract-actions';` (en la importación que ya existe de ese módulo) y `const docOpRunning = useDocOpJob((s) => s.label !== null);`.
- Sustituir `<DocOpJobProgress />` por `{docOpRunning && (<Suspense fallback={null}><DocOpJobProgress /></Suspense>)}`.
- `DocOpProgress.tsx` no cambia.
- Si algún test de UI busca el progreso con `getBy…` justo después de lanzar la operación, se cambia **solo** a `await findBy…` con la misma consulta. No se cambia ninguna otra aserción.

6c. Medir. Si después de 6a y 6b sigue por encima de 600 000 B: no tocar el presupuesto, anotar los bytes y los cinco ficheros más grandes de `staticFiles`, y dejar la ficha en `cambios-pedidos` para el líder.

### Respuestas a las dudas de la ronda 1
1. Bundle: ver paso 6.
2. Aceptado `maxCount = Number.MAX_SAFE_INTEGER` y contar en la app. Leer el lote entero antes de rechazar es aceptable: los ficheros los ha elegido el usuario y hay un límite de 50 MB por fichero.
3. Aceptado `images-dialog-store.ts` y las funciones añadidas.
4. Correcto: «Más acciones» solo se usa con un documento abierto. La entrada principal está en la pantalla de inicio.
5. Aceptados los cambios en `beginJob` y en `DocOpProgress`.

### Criterios añadidos (paso 6)
- [ ] `pnpm --filter lector-pdf build` (incluye `bundle:check`) con código 0. El arranque queda en ≤ 600 000 B, y anotar los bytes en el Registro. Objetivo ≤ 599 000.
- [ ] Siguen en verde: `tests/ui/images-dialog.test.tsx`, los tests de extraer, dividir y combinar, y `pnpm --filter lector-pdf e2e --project=chromium -g "imágenes|extraer|dividir|combinar"`.
- [ ] Todos los criterios de aceptación de arriba repetidos y con código 0. Después, commit y ficha a `en-revision`.

## Replanificación 2 (líder, 2026-10-20) · paso 7: diferir tres componentes más
El presupuesto **sigue sin subir** ([[ADR-0041-presupuesto-arranque-600kb]]). Lo hecho en los pasos 6a y 6b se conserva. El líder lo ha medido en una copia: con 7a + 7b + 7c el arranque queda en **599 276 B**. Solo se cambia `src/ui/App.tsx`, con el mismo patrón de `DocOpJobProgress` (6b).

7a. **Barra de lectura en voz alta** (solo se ve mientras se lee):
- Quitar `import { ReadAloudBar } from './read-aloud/ReadAloudBar';`.
- Junto a los demás `lazy`: `const ReadAloudBar = lazy(() => import('./read-aloud/ReadAloudBar').then((m) => ({ default: m.ReadAloudBar })));`
- En el componente: `const readAloudActive = useReadAloud((s) => s.status !== 'idle');` (`useReadAloud` ya está importado).
- Sustituir `<ReadAloudBar />` por `{readAloudActive && (<Suspense fallback={null}><ReadAloudBar /></Suspense>)}`.

7b. **Progreso de exportación** (solo durante una exportación):
- Quitar `import { ExportProgress } from './export/ExportProgress';`.
- `const ExportProgress = lazy(() => import('./export/ExportProgress').then((m) => ({ default: m.ExportProgress })));`
- Ampliar la importación existente: `import { useExportDialog, useExportJob } from '../state/export-actions';`
- `const exportRunning = useExportJob((s) => s.job.status === 'running');`
- Sustituir `<ExportProgress />` por `{exportRunning && (<Suspense fallback={null}><ExportProgress /></Suspense>)}`.

7c. **Progreso de impresión** (solo mientras se preparan las páginas):
- Quitar `import { PrintProgress } from './print/PrintProgress';`.
- `const PrintProgress = lazy(() => import('./print/PrintProgress').then((m) => ({ default: m.PrintProgress })));`
- Ampliar la importación existente: `import { openPrintDialog, usePrintDialog, usePrintJob } from '../state/print-actions';`
- `const printPreparing = usePrintJob((s) => s.job.status === 'preparing');`
- Sustituir `<PrintProgress />` por `{printPreparing && (<Suspense fallback={null}><PrintProgress /></Suspense>)}`.

Reglas:
- `ReadAloudBar.tsx`, `ExportProgress.tsx` y `PrintProgress.tsx` no cambian.
- Si un test de `tests/ui/print-dialog.test.tsx`, `export-dialog.test.tsx`, `read-aloud-bar.test.tsx` o `app*.test.tsx` busca la barra o el progreso con `getBy…` justo después de lanzar la acción, se cambia **solo** a `await findBy…` con la misma consulta. No se cambia ninguna otra aserción.
- Si tras 7a-7c el arranque sigue por encima de 600 000 B, no toques el presupuesto: anota los bytes y deja la ficha en `cambios-pedidos`.

### Criterios añadidos (paso 7)
- [ ] `pnpm --filter lector-pdf build` con código 0 y el arranque ≤ 600 000 B (esperado unos 599 300 B). Anotar los bytes en el Registro.
- [ ] E2E en verde: `pnpm --filter lector-pdf e2e --project=chromium -g "imprim|export|voz|imágenes|extraer|dividir|combinar"`.
- [ ] Siguen valiendo todos los criterios anteriores (lint, typecheck, coverage, e2e completo). Después, commit y ficha a `en-revision`.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: nuevos `apps/lector-pdf/src/state/images-dialog-store.ts`, `src/state/images-pdf-actions.ts`, `src/ui/messages-images.ts`, `src/ui/organize/ImagesDialog.tsx`, `ImagesDialog.module.css`, `tests/unit/images-pdf-actions.test.ts`, `tests/ui/images-dialog.test.tsx`, `tests/e2e/images-pdf.spec.ts`. Modificados: `src/state/extract-actions.ts` (`beginJob` acepta texto de progreso opcional), `src/ui/kit/DocOpProgress.tsx` (prop `progressText` opcional, por defecto «Copiando páginas…»), `src/ui/App.tsx`, `src/ui/open/EmptyState.tsx`, `src/ui/toolbar/DocumentMenu.tsx`.
- Qué he hecho: diálogo «Crear PDF desde imágenes» (lista con miniaturas, subir/bajar/quitar con Alt+↑/↓, tamaño de página y margen recordados en `images-pdf-options`), creación con op `images-to-pdf` y progreso cancelable; JPEG legibles van con sus bytes, el resto se decodifica a RGBA; límites de 500 imágenes, 50 MB y 50 Mpx con aviso. Entrada en la pantalla de inicio y en «Más acciones». Los criterios de test de la ficha tienen su prueba (unit, componente, E2E y `@perf`).
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK. `pnpm typecheck`: OK. `pnpm coverage`: OK (307 ficheros, 3974 tests; sin cambios en la cobertura de `core/`).
  - `pnpm --filter lector-pdf e2e images-pdf --project=chromium`: 3/3 OK. `--project=chromium-perf --no-deps`: 1/1 OK (20 JPEG de ~2 MB, sin long tasks > 100 ms).
  - `pnpm --filter lector-pdf e2e` completo (chromium, sin @perf): 320/320 OK.
  - `pnpm --filter lector-pdf bundle:check`: **FALLA**. Arranque 600 415 bytes, máximo 600 000 (en `HEAD`, medido en copia aparte: 598 188; el cambio añade 2 227 bytes al arranque).
- Dudas o cosas que no he podido hacer:
  1. **Presupuesto de bundle (bloquea la ficha).** Para cumplirlo habría que quitar piezas que la ficha pide o cambiar el presupuesto (PDF-074). Lo decide el líder: subir `ENTRY_JS_BUDGET_BYTES` a unos 601 000 o aceptar otro recorte. He aplicado la carga diferida de lo que se pudo (`messages-images`, el módulo de acciones y `core/pdf/image`, `core/export/plan` y `core/signature/image-art`), pero el arranque sigue 415 bytes por encima.
  2. `importFiles` de la plataforma devuelve `out-of-range` tanto por número como por tamaño. Para distinguir «más de 500» de «más de 50 MB» paso `maxCount = Number.MAX_SAFE_INTEGER` y compruebo el número en la app. Consecuencia: con un lote enorme se leen todos los ficheros antes de rechazar. Confirmar.
  3. La ficha pedía `useImagesDialog` en `images-pdf-actions.ts`. Está en `images-dialog-store.ts` y se re-exporta desde allí, para que la pantalla de inicio no cargue el módulo de acciones. Añadidos `closeImagesDialog`, `setImagesPageSize`, `setImagesMargin`, `IMAGES_MENU_ITEM` y `openImagesDialog` (carga diferida desde los botones).
  4. «Más acciones» está deshabilitado sin documento abierto (como «Combinar»), así que su entrada solo se usa con un documento. Confirmar que es lo esperado.
  5. Dos cambios en ficheros compartidos (opcionales, sin efecto en los existentes): `beginJob` y `DocOpProgress`.

### [lider] replanificación — 2026-10-20
- `bundle:check` 600 415 > 600 000. No se sube el presupuesto: [[ADR-0041-presupuesto-arranque-600kb]] es una decisión del usuario y manda diferir. Se difieren `DocOpJobProgress`, que solo se ve durante una operación, y el doble `import()` de las entradas. Paso 6.
- Dudas 2-5 resueltas en la ficha («Respuestas a las dudas de la ronda 1»).
- Ficha a `pendiente`, `intentos: 0`.

### [programador] ronda 2 — 2026-10-20
- Ficheros cambiados: `apps/lector-pdf/src/state/images-dialog-store.ts` (añadido `requestImagesDialog`), `src/ui/open/EmptyState.tsx` y `src/ui/toolbar/DocumentMenu.tsx` (usan `requestImagesDialog`), `src/ui/App.tsx` (`DocOpJobProgress` en `lazy` dentro de `Suspense`, montado solo con `docOpRunning = useDocOpJob((s) => s.label !== null)`). Ficha: estado y Registro.
- Qué he hecho: paso 6a y 6b aplicados tal como están escritos. Sin cambios en tests: `images-dialog.test.tsx` y los E2E de progreso siguen verdes sin cambiar ninguna aserción.
- Comandos ejecutados y resultado:
  - `pnpm lint`: OK. `pnpm typecheck`: OK. `pnpm coverage`: OK (código 0; Statements 95,04 %, Branches 89,73 %, Functions 97,9 %, Lines 98,33 %).
  - `pnpm --filter lector-pdf build`: **FALLA** en `bundle:check`. Arranque **600 580 B** (máximo 600 000; objetivo 599 000). Medido tras 6a y 6b; la ronda 1 anotó 600 415 B, así que estos pasos suman +165 B en vez de restar. No he tocado el presupuesto.
  - Cinco ficheros estáticos más grandes del arranque: `assets/index-DxAKpYkj.js` 309 171 B; `assets/view-actions-7vsnk1JM.js` 73 680 B; `assets/crypt-rules-BmCK6Udh.js` 28 570 B; `assets/to-pdf-DnIkaSql.js` 16 921 B; `assets/notice-CmE54Vo5.js` 14 966 B.
  - `pnpm --filter lector-pdf e2e --project=chromium` (completo, sin @perf): 320/320 OK. Subconjunto `-g "imágenes|extraer|dividir|combinar"`: 13/13 OK.
  - `e2e --project=chromium-perf --no-deps -g "20 JPEG"`: 1/1 OK.
  - Nota: el puerto 4173 lo ocupaba otro proceso ajeno (`vite preview`, arrancado a las 16:18). Las ejecuciones de e2e usan `LECTOR_E2E_PORT=4311` y `LECTOR_E2E_OUTDIR=dist-prog-129`.
- Dudas o cosas que no he podido hacer:
  1. **Presupuesto de bundle (bloquea la ficha).** Según el paso 6c, la ficha queda en `cambios-pedidos` para el líder. Con 6a y 6b el arranque sigue 580 B por encima del máximo. Para cumplirlo hay que decidir entre subir `ENTRY_JS_BUDGET_BYTES` (ADR-0041 lo prohíbe sin decisión del usuario) o diferir más código. Esto último no lo he hecho porque no está en la ficha.
  2. El criterio «`pnpm --filter lector-pdf build` con código 0» no se cumple, así que no pongo la ficha en `en-revision`.

### [lider] replanificación 2 — 2026-10-20
- 600 580 B > 600 000. No se sube el presupuesto: [[ADR-0041-presupuesto-arranque-600kb]] es una decisión del usuario y hay código fácil de diferir. Medido en una copia: diferir `ReadAloudBar` (−450 B), `ExportProgress` (−368 B) y `PrintProgress` (−486 B) deja el arranque en 599 276 B. Paso 7.
- Margen escaso (724 B). La siguiente ficha que añada código al arranque debe diferir algo más; candidatos para [[PDF-140-presupuesto-de-arranque]] o una ficha nueva: `PasswordDialog`, `ChoiceDialog` y el uso estático de `core/organize/split` desde `state/extract-actions.ts` (trozo `split` de 12,9 KB en el arranque).
- Ficha a `pendiente`, `intentos: 0`.
