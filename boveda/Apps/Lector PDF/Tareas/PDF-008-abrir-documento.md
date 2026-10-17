---
tipo: tarea
id: PDF-008
titulo: Abrir un documento en la app (botón, Ctrl+O, arrastrar, SO) con estados de carga y error
app: pdf
estado: en-revision
depende_de: [PDF-005, PDF-006, COM-006, COM-011]
intentos: 0
skills: [stack-typescript-react, stack-tauri, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, ui, abrir]
---

# PDF-008 · Abrir documento en la app

Plan: [[Apps/Lector PDF/Plan|Plan]] · Decisiones: [[ADR-0007-motor-y-visor-pdf]] · [[ADR-0008-plataforma-ficheros]] · [[ADR-0013-pdfjs-build-legacy]]

## Objetivo
El usuario abre un PDF con el botón «Abrir…», Ctrl+O, arrastrándolo a la ventana o (en escritorio) con "Abrir con"; ve un estado de carga con progreso y botón Cancelar, y si falla, un mensaje claro en español. Al terminar, el store tiene el documento, una tabla de dimensiones (supuesta y corregida en segundo plano) y el título de la ventana es «nombre.pdf — Lector PDF».

## Contexto
- Leer: `src/engine/index.ts` (PDF-005), `src/core/page-dims.ts` y `rotation.ts` (PDF-006), `src/core/title.ts`, `src/ui/App.tsx`, `src/ui/messages.ts`, `packages/platform/src/types.ts`, `packages/shared/src/shortcuts/` (COM-011).
- Si `@suite/platform` no está en `package.json` de la app, añádelo (`workspace:*`).
- Estado con **zustand**; las acciones viven fuera de los componentes. Los componentes leen con selectores finos (`useViewer(s => s.status)`).

## Qué hay que hacer
1. `src/state/services.ts`: `export interface AppServices { readonly platform: Platform; readonly assetBaseUrl: string }`, `initServices(s)`, `services()` (lanza `Error('Servicios no inicializados')` si no se llamó: es un bug).
2. `src/state/viewer-store.ts`:
   ```ts
   export type DocStatus = 'empty' | 'loading' | 'ready' | 'error';
   export interface ViewerState {
     readonly status: DocStatus;
     readonly file: OpenedFile | null;
     readonly pdf: LoadedPdf | null;
     readonly error: AppError | null;      // error al abrir
     readonly ioError: AppError | null;    // error de lectura con el documento ya abierto
     readonly loadingName: string | null;
     readonly loadProgress: number | null; // 0..1 o null si desconocido
     readonly dims: PageDimsTable | null;
     readonly dimsVersion: number;
     readonly currentPage: number;         // 0-based
   }
   export const initialViewerState: ViewerState;
   export const useViewer: UseBoundStore<StoreApi<ViewerState>>; // create<ViewerState>()(() => initialViewerState)
   ```
3. `src/state/document-actions.ts` (funciones, no hooks):
   ```ts
   export const PDF_FILTERS: readonly FileFilter[] = [{ name: 'Documentos PDF', extensions: ['pdf'] }];
   export async function openDocument(file: OpenedFile): Promise<void>;
   export function cancelOpening(): void;
   export async function closeDocument(): Promise<void>;
   export async function pickAndOpen(): Promise<void>;      // platform.openFile(PDF_FILTERS): null → nada; err → status 'error'; ok → openDocument
   export async function openDropped(dt: DataTransfer): Promise<void>;
   export function openBrowserFile(file: File): void;
   export function reportPageDims(entry: PageDimsEntry): void; // dims.set(...) y, si cambió, set({ dimsVersion })
   ```
   `openDocument`: incrementa un contador de aperturas (si al terminar ya no es la última, destruye el resultado y no toca el store); cierra el documento anterior (`pdf.destroy()`, `platform.closeFile`, aborta su escaneo); `status 'loading'`; `loadPdf(file.source, { assetBaseUrl, signal, onProgress })`. Si `ok`: `readPageDims(await doc.getPage(1))` → `PageDimsTable.uniform(...)` + `set(0, ...)`; `status 'ready'`, `currentPage 0`; `platform.setTitle(windowTitle(file.name, false))`; suscribe `pdf.onIoError` → `ioError`; si `numPages ≤ 20 000` lanza `scanPageDims(doc, { from: 1, signal, onBatch })` sin esperar (cada lote llama a `reportPageDims`). Si `err`: `status 'error'`, `error`, título por defecto. `cancelled` → vuelve a `'empty'` sin mensaje.
4. `src/ui/shortcuts.ts`: `export type ShortcutId = 'open';` y `export const shortcuts = new ShortcutRegistry<ShortcutId>([{ id: 'open', chords: ['Mod+O'], description: msg.open }])`. Las fichas siguientes añaden ids aquí.
   `src/ui/use-shortcuts.ts`: `export const ALLOW_IN_EDITABLE: ReadonlySet<ShortcutId> = new Set(['open'])` (las fichas siguientes añaden `save`, `save-as` y `find`) y `export function useShortcuts(handlers: Partial<Record<ShortcutId, () => void>>): void` — `keydown` en `window`; `shortcuts.match(e, platform.isMac)`; si el destino es editable (`isEditableTarget(e.target)`) y el id **no** está en `ALLOW_IN_EDITABLE`, se ignora (así Ctrl+Z o Ctrl+Mayús+flechas siguen funcionando dentro de un campo de texto); si hay *handler*: `e.preventDefault()` y lo llama.
5. Componentes en `src/ui/open/` (CSS Modules): `EmptyState.tsx` (título, pista, botón primario «Abrir…»), `LoadingState.tsx` (`role="status"`, «Abriendo «nombre»…», `<progress>` con `value` si hay progreso, botón «Cancelar»), `ErrorState.tsx` (`role="alert"`, «No se ha podido abrir «nombre»», `error.message`, botón «Abrir otro…»), `DropOverlay.tsx` (solo web: con ficheros arrastrados sobre la ventana muestra «Suelta el PDF para abrirlo»; al soltar llama a `openDropped`), `IoErrorBanner.tsx` (`role="alert"` con `ioError.message` y botón «Cerrar documento»).
6. `App.tsx`: según `status` muestra `EmptyState`/`LoadingState`/`ErrorState` o, en `ready`, `<div data-testid="document-ready">{msg.pageCount(numPages)}</div>` (lo sustituye el visor en PDF-009). Botón de la barra «Abrir…» con atajo formateado en el *tooltip*. En web, un `<input type="file" accept=".pdf,application/pdf" hidden data-testid="open-input">` cuyo `change` llama a `openBrowserFile`. `useShortcuts({ open: pickAndOpen })`.
7. `main.tsx`: `const platform = await loadPlatform({ prefsPrefix: 'lector-pdf.' })`; `initServices({ platform, assetBaseUrl: new URL('pdfjs/', document.baseURI).href })`; `platform.onFileOpenedFromOS(f => void openDocument(f))`; luego `render`.
8. `messages.ts`: añade `openShortcutHint`, `opening: (name) => ...`, `cancel: 'Cancelar'`, `openFailed: (name) => ...`, `openAnother: 'Abrir otro…'`, `dropHere: 'Suelta el PDF para abrirlo'`, `closeDocument: 'Cerrar documento'`, `pageCount: (n) => n === 1 ? '1 página' : `${n.toLocaleString('es-ES')} páginas``.
9. Tests: `tests/unit/document-actions.test.ts` (node, motor real con fixtures y una `Platform` falsa), `tests/ui/open.test.tsx` (jsdom, `vi.mock` de `../../src/engine` con un `loadPdf` falso controlable), `tests/e2e/open.spec.ts`.

## Criterios de aceptación
- [ ] (T) `openDocument(basic-5)` → `status 'ready'`, `dims.count 5`, `setTitle('basic-5.pdf — Lector PDF')`.
- [ ] (T) `openDocument(sizes-mixed)` → tras esperar al escaneo, `dims.width(1) === 792` y `dimsVersion` > el inicial.
- [ ] (T) Dos `openDocument` seguidos (A lento, B rápido): el store acaba con B y el `LoadedPdf` de A se destruye.
- [ ] (T) `corrupt-not-pdf.pdf` → `status 'error'` y `error.message === 'Este fichero no es un PDF.'`; `cancelOpening()` durante la carga → `status 'empty'`.
- [ ] (T) UI: con `loadPdf` pendiente se ve `role=status` con «Abriendo «a.pdf»…» y el botón Cancelar; al rechazar, `role=alert` con el mensaje; `Ctrl+O` llama a `platform.openFile` (con `user-event`); `Ctrl+O` dentro de un `<input>` de texto también funciona (usa `Mod`).
- [ ] (T) UI: el botón «Abrir…» tiene `title` «Abrir… (Ctrl+O)».
- [ ] E2E: `setInputFiles('[data-testid=open-input]', basic-5.pdf)` → `document-ready` dice «5 páginas» y `document.title` es «basic-5.pdf — Lector PDF»; con `corrupt-not-pdf.pdf` aparece «Este fichero no es un PDF.»; con `corrupt-empty.pdf` «El fichero está vacío (0 bytes).».
- [ ] E2E rendimiento: `pages-100000.pdf` muestra «100.000 páginas» en < 5 s desde `setInputFiles` (anota el tiempo).
- [ ] Estados vacío, carga y error con textos de `messages.ts`, navegables con teclado (Tab llega a los botones, foco visible).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0.

## Fuera de alcance
- Visor y render (PDF-009/010). Contraseñas (PDF-046). Recientes (PDF-049). App Tauri (PDF-021).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/state/{services,viewer-store,document-actions}.ts` (nuevos); `src/ui/{shortcuts,use-shortcuts}.ts` (nuevos); `src/ui/open/{EmptyState,LoadingState,ErrorState,DropOverlay,IoErrorBanner}.tsx` y `open.module.css` (nuevos); `src/ui/App.tsx`, `App.module.css` (quitadas las clases de la cabecera antigua), `messages.ts`, `src/main.tsx`; tests `tests/unit/document-actions.test.ts`, `tests/unit/services.test.ts`, `tests/ui/open.test.tsx`, `tests/e2e/open.spec.ts`, `tests/helpers/fake-platform.ts` (nuevos); `tests/ui/app.test.tsx` y `tests/e2e/smoke.spec.ts` (ahora buscan «Abrir…» dentro de la barra, porque el estado vacío tiene otro botón con ese nombre, y el `title` de la barra es «Abrir… (Ctrl+O)»).
- Qué he hecho: store zustand con las acciones de apertura (cola de aperturas: la última gana, las anteriores se destruyen al terminar; cancelación; escaneo de dimensiones hasta 20 000 páginas; `onIoError`), atajo Mod+O en el registro único (`Mod` también en campos de texto), estados vacío/carga/error/superposición de arrastre (web) y aviso de error de lectura, `<input type=file>` y arranque en `main.tsx`. Decisiones menores que tomé y conviene revisar: `closeDocument` también cancela una apertura en curso; un fallo del selector o de `openDropped` sustituye el documento actual por el error (como dice la ficha); `openShortcutHint` es una función `(atajo) => texto`.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK; `pnpm test` 60 ficheros / 773 tests OK; `pnpm coverage` OK (líneas 97,5 % en total); `pnpm --filter lector-pdf e2e`: **2 OK, 2 KO** (`basic-5` y `pages-100000`, que no llegan a mostrar el recuento; el medidor de 100 000 no se ha podido tomar).
- Bloqueo (técnico, decide el líder): pdf.js 6.4 (build principal que usa `src/engine/pdfjs.ts`) llama a `Map.prototype.getOrInsertComputed`. El Chromium de `/opt/pw-browsers` (chromium-1194, Playwright 1.56.1) no lo tiene: `UnknownErrorException: this._requestsByChunk.getOrInsertComputed is not a function`, `loadPdf` lo devuelve como `corrupt` y la UI muestra «El PDF está dañado…». Los tests de node pasan porque el alias de Vitest usa `pdfjs-dist/legacy/build`, que incluye polyfills. Opciones: (a) usar también la build `legacy` en el navegador (toca `engine/pdfjs.ts`, `engine/worker.ts` y `scripts/copy-pdfjs-assets.mjs`, ficheros de PDF-005/PDF-001); (b) añadir un polyfill como dependencia nueva (decisión del líder); (c) actualizar Chromium (no posible con `/opt/pw-browsers`). Probé a inyectar un polyfill en la página y no basta, así que no es un arreglo pequeño. No he tocado el motor.
- Dudas o cosas que no he podido hacer: falta confirmar la opción de motor (arriba) para cerrar los dos E2E y anotar el tiempo de `pages-100000`. Pendiente tras eso: el criterio de rendimiento E2E y la revisión de textos de los estados.

### [lider] desbloqueo — 2026-10-17
Decisión técnica: [[ADR-0013-pdfjs-build-legacy]] (opción a: build `legacy` de pdf.js también en navegador y worker). No cuenta como rechazo (`intentos` sigue en 0). Comprobado por el líder con tu código: con este cambio los 4 E2E de `open.spec.ts` pasan; el cambio se revirtió para que lo hagas tú.
Pasos exactos (se autoriza tocar estos ficheros de PDF-001/PDF-005):
1. `src/engine/pdfjs.ts`: en las dos líneas `from 'pdfjs-dist'` (el `export {...}` y el `export type {...}`) cambia el módulo a `'pdfjs-dist/legacy/build/pdf.mjs'`. La línea de `pdfjs-dist/types/src/display/api` no cambia. Añade al comentario de cabecera: `Build legacy por ADR-0013 (polyfills para Chromium/webviews sin Map.getOrInsertComputed).`
2. `src/engine/worker.ts`: `import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';` y `import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';`.
3. `scripts/copy-pdfjs-assets.mjs`: **no cambia** (`cmaps`, `standard_fonts`, `wasm`, `iccs` están en la raíz del paquete y valen para las dos builds).
4. No toques los alias de `vitest.config.ts` ni de `vitest.perf.config.ts` (los tests de fixtures importan `pdfjs-dist` directo). `src/engine/styles.ts` (`pdfjs-dist/web/pdf_viewer.css`) tampoco cambia.
5. Comprueba que ningún otro fichero de `src/` importa `pdfjs-dist/build/...` (`grep -rn "pdfjs-dist/build" src` vacío).
6. Termina los criterios pendientes: los 4 E2E de `open.spec.ts` en verde, **anota el tiempo** de `pages-100000.pdf` (desde `setInputFiles` hasta «100.000 páginas») en tu entrada, y revisa los textos de los estados.
7. Pasa todos los comandos de la ficha desde cero (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e`). Si `tests/ui/app.test.tsx` falla con `Servicios no inicializados` (lo vio PDF-025 bajo `pnpm coverage`), es de esta ficha: el test debe llamar a `initServices` con la `Platform` falsa de `tests/helpers/fake-platform.ts` en su `beforeEach`.

Decisiones menores del programador (ronda 1) aceptadas: `closeDocument` cancela una apertura en curso; un fallo del selector o de `openDropped` sustituye el documento por el error; `openShortcutHint` como función `(atajo) => texto`.

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `apps/lector-pdf/src/engine/pdfjs.ts` y `src/engine/worker.ts` (build `legacy` según [[ADR-0013-pdfjs-build-legacy]]); `src/engine/index.ts` (la re-exportación de `getDocument`, `OPS`… sale de `pdfjs-dist` y pasa a `./pdfjs`, para que el bundle no cargue la build principal); ficha `PDF-008` (Registro y estado).
- Qué he hecho: aplicados los pasos 1 a 5 del desbloqueo del líder. `grep` de `pdfjs-dist/build` en `src/` vacío y ningún otro import directo de `pdfjs-dist` fuera de `engine/pdfjs.ts`. `tests/ui/app.test.tsx` ya llama a `initServices` con `createFakePlatform()` en su `beforeEach`, así que no hizo falta cambiarlo. Revisados los textos de `messages.ts` y de los estados vacío, carga, error y aviso de lectura: se mantienen tal cual.
- Comandos ejecutados y resultado: `pnpm lint` OK; `pnpm typecheck` OK (en un primer intento falló en `tests/helpers/fake-platform.ts` por el `closeWindow` obligatorio que añadió el trabajo paralelo de COM-013; en la segunda ejecución ya pasaba, y no he tocado ese fichero en esta ronda); `pnpm test` 60 ficheros / 778 tests OK; `pnpm coverage` OK (líneas 89,1 % en total; un primer intento chocó con otro proceso de Vitest que usaba el mismo directorio de cobertura, y en el segundo pasó); `pnpm --filter lector-pdf e2e`: **5 de 5 OK** (los 4 de `open.spec.ts` y el de `smoke.spec.ts`).
- Tiempo de `pages-100000.pdf`: **444 ms** desde `setInputFiles` hasta «100.000 páginas» (medido con la anotación `rendimiento` de `open.spec.ts`, presupuesto < 5 000 ms; en las tres ejecuciones del E2E de 100 000 páginas el test pasó). Presupuesto cumplido.
- Dudas o cosas que no he podido hacer: no he tocado los criterios marcados `[ ]`; los verificará el tester. Commit de la ronda con solo mis ficheros (fuentes de `engine/` y esta ficha).
