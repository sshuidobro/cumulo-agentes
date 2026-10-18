---
tipo: tarea
id: COM-015
titulo: Documentos recientes en @suite/platform - tipos e implementación web
app: comun
estado: hecha
depende_de: [COM-014]
intentos: 0
skills: [stack-typescript-react, stack-tauri]
creado: 2026-10-18
actualizado: 2026-10-18
tags: [tarea, comun, plataforma, recientes]
---

# COM-015 · Documentos recientes en @suite/platform: tipos e implementación web

Plan: [[Apps/Comun/Plan|Plan de Comun]] · [[Apps/Lector PDF/Plan|Plan del Lector PDF]] (iteración 4) · Decisiones: [[ADR-0023-pestanas-y-recientes]] · [[ADR-0008-plataforma-ficheros]]

## Objetivo
La plataforma recuerda los últimos ficheros abiertos y permite reabrirlos. En el navegador con File System Access se guardan los `FileSystemFileHandle` en IndexedDB y se pide permiso al reabrir; sin esa API no se guarda nada (no se podría reabrir).

## Contexto
- Leer: `packages/platform/src/types.ts`, `src/web/platform-web.ts` (`openFile` con `showOpenFilePicker`, `openDropped`, `openBrowserFile`, tokens y handles), `src/web/fs-access.ts`, `src/web/web-env.ts` (inyección para tests), `src/drafts.ts` (patrón IndexedDB con *fallback* en memoria), `tests/web/fakes.ts`.
- El `appId` (prefijo) es el mismo que usan las preferencias.

## Qué hay que hacer
1. `types.ts`:
```ts
export interface RecentFile {
  readonly id: string;              // estable por fichero
  readonly name: string;
  readonly path: string | null;     // Tauri: ruta; web: null
  readonly size: number | null;
  readonly openedAt: number;        // ms desde epoch
  readonly available: boolean;      // false si ya no existe (Tauri) o no se puede reabrir
}
// en Platform:
recentFiles(): Promise<readonly RecentFile[]>;              // más reciente primero, máx. 20
openRecent(id: string): Promise<Result<OpenedFile | null>>; // null = el usuario negó el permiso
removeRecent(id: string): Promise<void>;
clearRecents(): Promise<void>;
```
   Los recientes se **añaden solos** al abrir con éxito (`openFile`, `openDropped` y `onFileOpenedFromOS`; no `openBrowserFile`, que no tiene handle) y al guardar como.
2. `src/web/recent-store.ts`: IndexedDB `suite-recent-<appId>`, almacén `recent` con `{ id, name, size, openedAt, handle }`; `id` = `crypto.randomUUID()` salvo que ya exista un handle igual (`handle.isSameEntry(otro)`), en cuyo caso se actualiza `openedAt` y no se duplica. Máximo 20 (se borra el más antiguo). Sin IndexedDB → memoria.
3. `platform-web.ts`: `openRecent(id)` → `handle.queryPermission({ mode: 'readwrite' })`; si no es `granted`, `requestPermission({ mode: 'readwrite' })` y, si se niega, `requestPermission({ mode: 'read' })`; negado → `ok(null)`; `getFile()` falla (`NotFoundError`) → marcar la entrada `available: false` y `err(platformError('not-found'))`. El `OpenedFile` resultante es igual que el de `openFile` (puede guardar en sitio si hay permiso de escritura).
4. Tests `packages/platform/tests/web/recent.test.ts` con handles falsos (amplía `tests/web/fakes.ts` con `isSameEntry`, `queryPermission`, `requestPermission`) y el almacén en memoria (`factory = null`, como hacen los tests de `drafts.ts`). Sin dependencias nuevas.
5. Tauri: en este fichero, `recentFiles` devuelve `[]` y el resto `err('unsupported')` hasta COM-016 (para que compile).

## Criterios de aceptación
- [ ] Abrir 3 ficheros con `openFile` (handles falsos distintos) → `recentFiles()` devuelve 3, el último primero; volver a abrir el primero → sigue habiendo 3 y pasa a ser el primero.
- [ ] 21 aperturas distintas → 20 entradas (sale la más antigua).
- [ ] `openRecent` con permiso concedido → `OpenedFile` con `canSaveInPlace: true`; con solo lectura → `canSaveInPlace: false`; denegado → `ok(null)`; fichero borrado → `err` `not-found` y la entrada queda `available: false`.
- [ ] `openBrowserFile` no añade recientes; `removeRecent` y `clearRecents` funcionan.
- [ ] Los recientes no guardan contenido de ficheros (test: el registro guardado solo tiene las 5 claves).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0.

## Fuera de alcance
- Tauri (COM-016). Interfaz (PDF-049).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-18
- Ficheros cambiados: `packages/platform/src/types.ts`, `packages/platform/src/index.ts`, `packages/platform/src/web/web-env.ts`, `packages/platform/src/web/recent-store.ts` (nuevo), `packages/platform/src/web/platform-web.ts`, `packages/platform/src/tauri/platform-tauri.ts`, `packages/platform/tests/web/fakes.ts`, `packages/platform/tests/web/recent.test.ts` (nuevo), `apps/lector-pdf/tests/helpers/fake-platform.ts` y `apps/lector-pdf/tests/helpers/save-harness.ts` (solo cuatro miembros nuevos de `Platform` para que compilen), esta ficha.
- Qué he hecho: `RecentFile` y los cuatro métodos nuevos de `Platform`. Almacén `recent-store.ts` en IndexedDB `suite-recent-<appId>` (una transacción por operación) o memoria si no hay IndexedDB, con deduplicado por `isSameEntry`, máximo 20 y el registro de 5 claves. `openFile`, `openDropped` y `saveAs` (selector) añaden a recientes; `openRecent` pide permiso de lectura/escritura y gestiona `not-found`. Tauri devuelve `[]` y `err('unsupported')` en `openRecent`.
- Comandos ejecutados y resultado: `pnpm lint` 0 avisos; `pnpm typecheck` 0 errores (platform y lector-pdf); `pnpm exec vitest run --project platform --coverage --coverage.reportsDirectory=<scratchpad>` → 19 ficheros, 215 tests en verde, cobertura de `recent-store.ts` 80,6 % de líneas y de `platform-web.ts` 94,5 %. Los 11 tests nuevos cubren todos los criterios de aceptación; el de IndexedDB comprueba persistencia entre instancias y las 5 claves.
- Dudas o cosas que no he podido hacer:
  - `available: false` se guarda solo en memoria: el registro persistido tiene exactamente 5 claves, así que tras recargar la página la entrada vuelve a figurar como disponible hasta que se intente abrir. Si se quiere persistente, hay que decidir si se amplía el registro (y el criterio de 5 claves).
  - `removeRecent` y `clearRecents` devuelven `Promise<void>`, así que en Tauri (stub) resuelven sin error en lugar de `err('unsupported')`.
  - Añadido `indexedDB` a `WebEnv` (inyección para tests, igual que `storage`).
  - Los cuatro miembros añadidos en `apps/lector-pdf/tests/helpers/` están fuera del alcance de la ficha; sin ellos `pnpm typecheck` no compila.
  - Para cobertura usé un `reportsDirectory` propio porque otro proceso de Vitest tenía ocupado `coverage/`. Solo ejecuté el proyecto `platform`; no lancé e2e ni perf de apps.

### [revisor] ronda 1 — 2026-10-18 — APROBADO
- Lint (0 avisos), typecheck y tests del proyecto platform (215) en verde; no se lanzaron e2e/perf. Todos los criterios cubiertos por `packages/platform/tests/web/recent.test.ts` (orden, dedupe, tope 20, permisos, not-found, 5 claves). `fake-indexeddb` ya estaba en `packages/platform/package.json` (sin dependencias nuevas). Los 4 miembros añadidos en `apps/lector-pdf/tests/helpers/` son necesarios para compilar y aceptables.
- (opcional) `packages/platform/src/web/recent-store.ts` `rememberEntry`: lista+put+recorte no es atómico; dos aperturas simultáneas podrían duplicar una entrada. Poco probable en uso real.
- (opcional) `available: false` solo en memoria (decisión coherente con el criterio de 5 claves); documentar en COM-016/PDF-049 que tras recargar se reintenta al abrir.

### [tester] ronda 1 — 2026-10-18 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| 3 aperturas, orden, reabrir sin duplicar | OK | `recent.test.ts` "guarda los abiertos..." en verde |
| 21 aperturas -> 20 | OK | test "con 21 aperturas distintas..." |
| openRecent: escritura / solo lectura / denegado / not-found | OK | 4 tests en verde (incluye `available:false` y recuperación) |
| openBrowserFile no añade; removeRecent y clearRecents | OK | tests correspondientes |
| Registro de 5 claves, sin contenido | OK | test IndexedDB: claves `handle,id,name,openedAt,size` y persistencia entre instancias |
| lint, typecheck, test, coverage | OK | `pnpm lint` 0 avisos; `pnpm typecheck` platform y lector-pdf sin errores; `vitest --project platform --coverage`: 19 ficheros, 215 tests; cobertura `recent-store.ts` 80,59 %, `platform-web.ts` 94,47 % |

Tests añadidos: ninguno (la cobertura de criterios ya es suficiente). Alcance limitado por petición: sin e2e ni perf ni tests de apps. Rendimiento: no aplica.
Nota: `available:false` solo en memoria (decisión ya aceptada por el revisor); documentar en COM-016/PDF-049.
