---
tipo: tarea
id: COM-010
titulo: Implementar Platform para Tauri (TypeScript) con mocks
app: comun
estado: en-revision
depende_de: [COM-005]
intentos: 0
skills: [stack-tauri, stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, tauri]
---

# COM-010 · Platform para Tauri (TypeScript)

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
`createTauriPlatform()` implementa `Platform` llamando a los comandos `suite_*` de [[COM-009-comandos-tauri-platform]], y `loadPlatform()` elige web o Tauri. Probado con dependencias inyectadas y un test de humo con `mockIPC`.

## Contexto
- Leer: `packages/platform/src/types.ts`, `src/web/platform-web.ts` (mismo estilo), `src/detect.ts`, la tabla de comandos de [[COM-009-comandos-tauri-platform]] (nombres, parámetros y cabeceras **exactos**).
- Solo `packages/platform/src/tauri/**` puede importar `@tauri-apps/*` (lint).
- Los errores de `invoke` llegan como objeto `{ code, message }` (serialización de `CommandError`).

## Qué hay que hacer
1. `packages/platform/package.json`: `dependencies` añade `"@tauri-apps/api": "2.12.4"`, `"@tauri-apps/plugin-opener": "2.7.2"`.
2. `src/tauri/tauri-api.ts`:
   ```ts
   export interface InvokeOptions { readonly headers: Record<string, string> }
   export interface TauriApi {
     invoke<T>(cmd: string, args?: Record<string, unknown> | Uint8Array, options?: InvokeOptions): Promise<T>;
     listen(event: string, handler: () => void): Promise<() => void>;
     setTitle(title: string): Promise<void>;
     onCloseRequested(handler: (preventDefault: () => void) => void): Promise<() => void>;
     openUrl(url: string): Promise<void>;
   }
   export function realTauriApi(): TauriApi; // envuelve invoke (@tauri-apps/api/core), listen (event), getCurrentWindow().setTitle/onCloseRequested (window), openUrl (@tauri-apps/plugin-opener)
   ```
3. `src/tauri/platform-tauri.ts`: `export function createTauriPlatform(options: { readonly prefsPrefix: string }, api: TauriApi = realTauriApi()): Platform`.
   - `interface FileInfoDto { token: string; name: string; path: string; size: number; lastModified: number | null }` y `toOpened(dto)` → `canSaveInPlace: true`, `source = tauriSource(dto.token, dto.size)`.
   - `tauriSource.read(b, e)`: valida como `memorySource` (`out-of-range`); `b === e` → vacío sin llamar; si no `invoke<ArrayBuffer>('suite_read_range', { token, offset: b, length: e - b })` → `Uint8Array`. Error → `PlatformIoError(mapCode(err.code))`.
   - `mapCode`: códigos de `PlatformErrorCode` se respetan; `unknown-token` → `not-found`; cualquier otro (incluido `bad-request` o un error sin `code`) → `io`.
   - `openFile(filters)` → `invoke('suite_open_dialog', { filters })`. `openBrowserFile` → `err(platformError('unsupported'))`. `openDropped` → `ok(null)`.
   - `save(target, data)`: `bytes` → `invoke('suite_write_atomic', data.bytes, { headers: { 'x-suite-token': target.token } })`; `append` → `invoke('suite_append_atomic', data.delta, { headers: { 'x-suite-token': target.token, 'x-suite-base-token': data.base.token, 'x-suite-expected-size': String(data.expectedSize) } })`. Devuelve `ok(toOpened(dto))`; error → `err(platformError(mapCode(code)))`.
   - `saveAs(name, filters, data)` → `invoke('suite_save_dialog', { suggestedName: name, filters })`; `null` → `{ kind: 'cancelled' }`; si no, `save(destino, data)` → `{ kind: 'saved', file }`.
   - `closeFile` → `invoke('suite_close', { token })`.
   - `onFileOpenedFromOS(cb)`: función interna `drain()` = `invoke<FileInfoDto[]>('suite_take_pending_opens')` y `cb(toOpened(x))` por cada uno. Llama a `drain()` al suscribirse y en cada evento `'suite://file-opened'` (`api.listen`). Devuelve una función que quita el listener (también si se llama antes de que `listen` resuelva).
   - `openExternalUrl` → misma validación de protocolos que la web; `api.openUrl(url)`.
   - `setTitle` → `api.setTitle` (si rechaza, `createLogger('platform').warn`). `onCloseRequested(cb)` → `api.onCloseRequested(prevent => { if (!cb()) prevent(); })`.
   - `isMac`: `navigator.userAgent` contiene `Mac`; `prefs`: `createStorageStore(localStorage, prefsPrefix)` (con `try` → `null`).
4. `src/tauri/index.ts` reexporta `createTauriPlatform`. `detect.ts`: `loadPlatform` usa `isTauri()` → `import('./tauri/index')` → `createTauriPlatform(options)`; si no, la web.
5. Tests `tests/tauri/platform-tauri.test.ts` con un `TauriApi` falso, y `tests/tauri/mock-ipc.test.ts` que usa `mockIPC` de `@tauri-apps/api/mocks` + `realTauriApi()` para `suite_read_range` (devuelve un `ArrayBuffer` de 3 bytes) y `clearMocks()` al final.

## Criterios de aceptación
- [ ] (T) `openFile` con DTO `{ token: 't1', name: 'a.pdf', path: '/x/a.pdf', size: 10, lastModified: 5 }` → `OpenedFile` con esos datos y `canSaveInPlace true`; `null` → `ok(null)`; rechazo `{ code: 'permission-denied' }` → `err` con ese código.
- [ ] (T) `source.read(2, 5)` invoca `suite_read_range` con `{ token: 't1', offset: 2, length: 3 }`; `read(4,4)` no invoca nada; error `{ code: 'unknown-token' }` → `PlatformIoError` `not-found`.
- [ ] (T) `save` en modo `append` envía el delta como cuerpo y las 3 cabeceras exactas (`x-suite-expected-size` como texto); `bytes` envía la cabecera `x-suite-token`.
- [ ] (T) `saveAs` cancelado → `{ kind: 'cancelled' }`; aceptado → `{ kind: 'saved' }` con el token del diálogo.
- [ ] (T) `onFileOpenedFromOS`: con 2 pendientes al suscribirse → `cb` 2 veces; al disparar el evento con 1 pendiente más → 3; tras darse de baja, otro evento no llama a `cb`.
- [ ] (T) `onCloseRequested(() => false)` llama a `preventDefault`; `openExternalUrl('javascript:x')` → `err` `unsupported` sin llamar a `openUrl`.
- [ ] (T) Humo con `mockIPC`: `realTauriApi().invoke('suite_read_range', ...)` devuelve los 3 bytes.
- [ ] (T) `loadPlatform` con `window.__TAURI_INTERNALS__` definido devuelve `kind 'tauri'`; sin él, `'web'`.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `src/tauri/platform-tauri.ts` ≥ 85 % de líneas.

## Fuera de alcance
- Código Rust (COM-009) y la app Tauri (PDF-021).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/src/tauri/tauri-api.ts` y `platform-tauri.ts` (nuevos), `packages/platform/src/tauri/index.ts` (nuevo, reexporta `createTauriPlatform`), `packages/platform/src/detect.ts` (rama Tauri en `loadPlatform`), `packages/platform/package.json` (`@tauri-apps/api@2.12.4`, `@tauri-apps/plugin-opener@2.7.2`), `pnpm-lock.yaml`, `tests/tauri/platform-tauri.test.ts`, `tests/tauri/mock-ipc.test.ts`, `tests/tauri/load-platform.test.ts` (nuevos).
- Qué he hecho: `createTauriPlatform(options, api)` implementa `Platform` sobre los comandos `suite_*` de COM-009 (lectura por rangos con `suite_read_range`, guardado `bytes`/`append` con las cabeceras exactas, diálogos, `suite_take_pending_opens` + evento `suite://file-opened`, enlaces con la misma lista blanca de protocolos que web, título y cierre). `realTauriApi()` es el único código que importa `@tauri-apps/*`. `loadPlatform` elige Tauri si hay `__TAURI_INTERNALS__`.
- Comandos ejecutados y resultado: `pnpm install` → ok. `pnpm lint` → 0. `pnpm typecheck` → 0. `pnpm test` → 24 ficheros, 257 tests en verde. `pnpm coverage` → 0 (97,06 % líneas globales). `src/tauri/platform-tauri.ts` 97,4 % líneas (requisito ≥ 85 %). `mockIPC` de `suite_read_range` devuelve los 3 bytes.
- Dudas o cosas que no he podido hacer: (1) `depende_de` solo lista COM-005, pero `loadPlatform` y la rama web dependen de COM-006; lo he tomado de COM-006 ya commiteado (ac6e184). Conviene añadirlo a `depende_de`. (2) `TauriApi.listen`/`onCloseRequested` devuelven la baja de forma síncrona; si la baja llega antes de que resuelva el registro, se quita al resolver. (3) `drain()` no entrega ficheros si ya se dio de baja, pero una recogida en vuelo en ese instante se pierde; anotado para revisión. (4) `closeFile` deja propagar un rechazo de `suite_close` (la ficha no dice otra cosa). (5) `realTauriApi()` queda sin cubrir salvo `invoke` (solo `mock-ipc` lo ejercita; el umbral de la ficha solo aplica a `platform-tauri.ts`). (6) La ruta real de Tauri (ventana, plugins) se verificará con la app PDF-021.
