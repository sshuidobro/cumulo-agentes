---
tipo: tarea
id: COM-005
titulo: Crear @suite/platform con tipos, ByteSource y preferencias
app: comun
estado: en-test
depende_de: [COM-004]
intentos: 1
skills: [stack-typescript-react, stack-tauri, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform]
---

# COM-005 · Crear @suite/platform con tipos, ByteSource y preferencias

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]] · [[ADR-0010-stack-apps-web-y-pruebas]]

## Objetivo
Existe el paquete `@suite/platform` con la interfaz `Platform` (sin implementaciones aún), lectura por rangos en memoria y desde `Blob`, errores con mensajes en español y un almacén de preferencias sobre `localStorage`.

## Contexto
- Leer: [[ADR-0008-plataforma-ficheros]], `packages/shared/src/result.ts`, `packages/shared/src/logger.ts`, `packages/shared/package.json` (modelo de paquete solo fuente).
- El paquete usa DOM (`Blob`, `Storage`, `File`, `DataTransfer`): tiene su propio `tsconfig.json`.

## Qué hay que hacer
1. `packages/platform/package.json`:
   ```json
   { "name": "@suite/platform", "version": "0.0.0", "private": true, "type": "module",
     "exports": { ".": "./src/index.ts" },
     "scripts": { "typecheck": "tsc -p tsconfig.json" },
     "dependencies": { "@suite/shared": "workspace:*" },
     "devDependencies": { "jsdom": "30.1.3" } }
   ```
   `tsconfig.json`: `{ "extends": "../../tsconfig.base.json", "compilerOptions": { "lib": ["es2023", "dom", "dom.iterable"] }, "include": ["src", "tests", "vitest.config.ts"] }`.
   `vitest.config.ts`: `defineProject({ test: { name: 'platform', include: ['tests/**/*.test.ts'], environment: 'jsdom' } })`.
2. `src/types.ts` (exactamente):
   ```ts
   import type { Result } from '@suite/shared';
   /** Lectura por rangos. `end` exclusivo. Rechaza con PlatformIoError si falla la E/S. */
   export interface ByteSource { readonly size: number; read(begin: number, end: number): Promise<Uint8Array>; }
   export interface FileFilter { readonly name: string; readonly extensions: readonly string[]; }
   export interface OpenedFile {
     readonly token: string;            // id opaco de la implementación
     readonly name: string;             // "informe.pdf"
     readonly path: string | null;      // ruta absoluta en Tauri; null en web
     readonly size: number;
     readonly lastModified: number | null; // ms desde epoch
     readonly canSaveInPlace: boolean;
     readonly source: ByteSource;
   }
   export type SaveData =
     | { readonly kind: 'bytes'; readonly bytes: Uint8Array }
     | { readonly kind: 'append'; readonly base: OpenedFile; readonly expectedSize: number; readonly delta: Uint8Array };
   export type SaveOutcome =
     | { readonly kind: 'saved'; readonly file: OpenedFile }
     | { readonly kind: 'downloaded'; readonly name: string }
     | { readonly kind: 'cancelled' };
   export type PlatformErrorCode = 'not-found' | 'permission-denied' | 'io' | 'changed-on-disk'
     | 'save-in-place-unsupported' | 'unsupported' | 'out-of-range';
   export interface KeyValueStore {
     get<T>(key: string, guard: (v: unknown) => v is T): T | null;
     set(key: string, value: unknown): void;
     remove(key: string): void;
   }
   export interface Platform {
     readonly kind: 'web' | 'tauri';
     readonly isMac: boolean;
     readonly prefs: KeyValueStore;
     /** null = el usuario canceló. */
     openFile(filters: readonly FileFilter[]): Promise<Result<OpenedFile | null>>;
     /** Web: fichero de un <input type=file>. Tauri: err('unsupported'). */
     openBrowserFile(file: File): Result<OpenedFile>;
     /** Web: primer fichero soltado. Tauri: ok(null) (lo gestiona onFileOpenedFromOS). */
     openDropped(dt: DataTransfer): Promise<Result<OpenedFile | null>>;
     /** Guarda encima de `target` de forma atómica y devuelve el fichero reabierto. */
     save(target: OpenedFile, data: SaveData): Promise<Result<OpenedFile>>;
     saveAs(suggestedName: string, filters: readonly FileFilter[], data: SaveData): Promise<Result<SaveOutcome>>;
     closeFile(file: OpenedFile): Promise<void>;
     onFileOpenedFromOS(cb: (file: OpenedFile) => void): () => void;
     openExternalUrl(url: string): Promise<Result<void>>;
     setTitle(title: string): void;
     /** cb devuelve true para permitir cerrar, false para cancelar. */
     onCloseRequested(cb: () => boolean): () => void;
   }
   ```
3. `src/messages.ts`: `export const PLATFORM_MESSAGES: Readonly<Record<PlatformErrorCode, string>>` con:
   `not-found` "No se encuentra el fichero. Puede que se haya movido o borrado." · `permission-denied` "No hay permiso para acceder al fichero." · `io` "No se ha podido leer o escribir el fichero." · `changed-on-disk` "El fichero ha cambiado en el disco desde que se abrió. Guarda una copia con «Guardar como»." · `save-in-place-unsupported` "Este navegador no permite guardar encima del original. Se guardará una copia." · `unsupported` "Esta acción no está disponible en esta versión." · `out-of-range` "Se ha intentado leer fuera del fichero."
4. `src/errors.ts`:
   ```ts
   export class PlatformIoError extends Error {
     constructor(readonly code: PlatformErrorCode, options?: { cause?: unknown }); // message = PLATFORM_MESSAGES[code]; name = 'PlatformIoError'
   }
   export function platformError(code: PlatformErrorCode, cause?: unknown): AppError; // { code, message: PLATFORM_MESSAGES[code], cause } (sin la clave cause si es undefined)
   ```
5. `src/byte-source.ts`:
   ```ts
   export function memorySource(bytes: Uint8Array): ByteSource;   // read devuelve una COPIA (slice)
   export function blobSource(blob: Blob): ByteSource;            // new Uint8Array(await blob.slice(b, e).arrayBuffer())
   export async function readAll(source: ByteSource, chunkSize = 4 * 1024 * 1024): Promise<Uint8Array>;
   ```
   Validación en `read` (ambas): si no `0 <= begin <= end <= size` o no son enteros → rechaza con `PlatformIoError('out-of-range')`. Error de `arrayBuffer()` → `PlatformIoError('io', { cause })`.
6. `src/prefs.ts`: `export function createStorageStore(storage: Storage | null, prefix: string): KeyValueStore`. Claves reales `${prefix}${key}`. `get`: JSON inválido o `guard` falso → borra la clave y devuelve `null`. `set`: `JSON.stringify`; si `setItem` lanza (cuota), `createLogger('platform').warn(...)` y no lanza. `storage === null` → usa un `Map` en memoria.
7. `src/detect.ts`: `export function isTauri(win: object = globalThis): boolean` → `'__TAURI_INTERNALS__' in win`.
8. `src/index.ts`: reexporta tipos (con `export type`), `PLATFORM_MESSAGES`, `PlatformIoError`, `platformError`, `memorySource`, `blobSource`, `readAll`, `createStorageStore`, `isTauri`.
9. Tests en `packages/platform/tests/` (`byte-source.test.ts`, `prefs.test.ts`, `errors.test.ts`, `detect.test.ts`).

## Criterios de aceptación
- [ ] (T) `memorySource(Uint8Array.of(1,2,3,4,5)).read(1,4)` → `[2,3,4]`; modificar el resultado no cambia la fuente; `read(0,0)` → longitud 0; `read(3,2)`, `read(-1,2)`, `read(0,6)`, `read(0.5,2)` rechazan con `PlatformIoError` y `code === 'out-of-range'`.
- [ ] (T) `blobSource(new Blob([bytes]))` devuelve los mismos rangos que `memorySource`; `readAll` con `chunkSize` 2 sobre 5 bytes devuelve los 5 bytes exactos.
- [ ] (T) Un `Blob` cuyo `slice().arrayBuffer()` rechaza → `PlatformIoError` con `code === 'io'` y `cause` original.
- [ ] (T) Prefs: `set('a', {n:1})` y `get('a', isN)` → `{n:1}`; clave guardada en `localStorage` como `prefijo.a`; JSON roto → `null` y la clave desaparece; `guard` falso → `null`; `setItem` que lanza no propaga y llama al logger (sink falso); `createStorageStore(null, 'x.')` funciona en memoria.
- [ ] (T) `platformError('changed-on-disk').message` es el texto en español de la tabla; `isTauri({ __TAURI_INTERNALS__: {} })` → `true`, `isTauri({})` → `false`.
- [ ] `pnpm lint`, `pnpm typecheck` (incluye `packages/platform`), `pnpm test` (aparece `|platform|`) y `pnpm coverage` con código 0; cobertura de `packages/platform/src` ≥ 90 % de líneas.

## Fuera de alcance
- Implementaciones web y Tauri (COM-006, COM-007, COM-010) y `loadPlatform()` (COM-006).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/package.json`, `packages/platform/tsconfig.json`, `packages/platform/vitest.config.ts`, `packages/platform/src/{types,messages,errors,byte-source,prefs,detect,index}.ts`, `packages/platform/tests/{byte-source,prefs,errors,detect}.test.ts`, `pnpm-lock.yaml` (solo `jsdom@30.1.3` y el importer de `@suite/platform`).
- Qué he hecho: paquete `@suite/platform` con la interfaz `Platform` y `ByteSource` tal cual la ficha; `memorySource`, `blobSource` y `readAll` con validación de rangos (`out-of-range`) y envoltorio `io` sobre `arrayBuffer`; `createStorageStore` sobre `Storage` (prefijo, JSON roto y guard falso borran la clave, cuota sin propagar y con aviso por el logger, modo memoria con `null`); `isTauri`, mensajes en español y `PlatformIoError`/`platformError`.
- Comandos ejecutados y resultado: `pnpm install` OK; `pnpm lint` 0 avisos; `pnpm typecheck` OK (incluye `packages/platform`); `pnpm test` 138 tests en verde (13 ficheros, incluye `|platform|` con 33 tests); `pnpm coverage` exit 0, cobertura 100 % de líneas global (ficheros de platform sin líneas sin cubrir).
- Dudas o cosas que no he podido hacer: en el test de cuota no uso `vi.spyOn(localStorage, 'setItem')` porque jsdom no lo intercepta; se usa un `Storage` falso que lanza en `setItem`. En un primer `pnpm test` apareció un fallo en `packages/shared/tests/shortcuts/chord.test.ts` (trabajo en curso de COM-011, ajeno); en la siguiente ejecución estaba en verde. No he tocado ficheros de otros programadores (`packages/platform/rust/`, `packages/shared/src/index.ts`, fichas COM-004/008/011).

### [revisor] ronda 1 — 2026-10-17 — CAMBIOS
Lint, typecheck y `pnpm test` en verde (`|platform|` aparece, 33 tests); el código y los tests cumplen la ficha. Un problema bloqueante:
1. `vitest.config.ts` (raíz) / `packages/platform/vitest.config.ts` — la cobertura de `packages/platform/src` NO se mide: `pnpm coverage` sale con 0, pero el informe solo lista `shared/src`; `pnpm vitest run --coverage --project platform` da 0/0 ficheros. El "100 % global" del Registro no incluye platform, así que el criterio "cobertura de `packages/platform/src` ≥ 90 %" no está demostrado. Hay que averiguar por qué el proyecto jsdom no aporta cobertura v8 (p. ej. inclusión/raíz del proyecto, o configuración de `coverage.include`/`root`), arreglarlo sin tocar el umbral y comprobar que el informe muestra `byte-source.ts`, `prefs.ts`, `errors.ts`, `detect.ts`, `messages.ts` con ≥ 90 % de líneas.
2. `packages/platform/src/byte-source.ts:42` (opcional) — `readAll` con `chunkSize` ≤ 0 o no entero entra en bucle infinito; validar y lanzar un error claro.
3. `packages/platform/src/prefs.ts:19` (opcional) — `getItem` puede lanzar (SecurityError con cookies bloqueadas); envolverlo para devolver `null`.

### [programador] ronda 2 — 2026-10-17
- Ficheros cambiados: `vitest.config.ts` (raíz), `packages/platform/src/byte-source.ts`, `packages/platform/src/prefs.ts`, `packages/platform/tests/byte-source.test.ts`, `packages/platform/tests/prefs.test.ts`, esta ficha.
- Qué he hecho: (1) Cobertura: la medición ya incluía `packages/platform/src` en `pnpm coverage`, pero el reporte de texto oculta los ficheros al 100 % y `--project platform` daba 0/0 porque el `include` se resolvía contra la raíz del proyecto. Ahora el `include` admite ambas raíces (`src/**/*.ts` además de `packages/*/src/**/*.ts`) y el reporte incluye `json-summary`; `packages/platform/vitest.config.ts` queda como en la ficha (la cobertura a nivel de proyecto se ignora). Umbral sin tocar. (2) `readAll` rechaza `chunkSize` no entero o ≤ 0 con `RangeError` antes de leer (es un error de programación). (3) `createStorageStore.get` envuelve `getItem`: si lanza, avisa por el logger y devuelve `null`. Tests nuevos para los tres casos (`chunkSize` inválido ×5, `getItem` que lanza).
- Comandos ejecutados y resultado: `pnpm lint` OK (0 avisos); `pnpm typecheck` OK (incluye `packages/platform`); `pnpm test` 14 ficheros, 153 tests en verde (`|platform|` incluido); `pnpm coverage` exit 0 con `packages/platform/src` al 100 % de líneas (ver `coverage/coverage-summary.json`); `pnpm vitest run --coverage --project platform` exit 0, 50/50 líneas.
- Dudas o cosas que no he podido hacer: ninguna. No he tocado ficheros de COM-009, COM-011 ni los cambios en curso de otros agentes (`packages/platform/rust/`, `packages/shared/tests/logger.test.ts`, otras fichas).

### [revisor] ronda 2 — 2026-10-17 — APROBADO
`pnpm lint` (0 avisos), `pnpm typecheck` (incluye platform), `pnpm test` (153 en verde, `|platform|`) y `pnpm coverage` (exit 0) correctos. `coverage-summary.json` lista los 7 ficheros de `packages/platform/src` al 100 % de líneas; umbral sin tocar. Los dos puntos opcionales de la ronda 1 (`chunkSize` inválido y `getItem` que lanza) están resueltos y con tests. 0 problemas.
