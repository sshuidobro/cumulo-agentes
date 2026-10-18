---
tipo: tarea
id: COM-012
titulo: Crear el almacén de borradores en IndexedDB (DraftStore)
app: comun
estado: hecha
depende_de: [COM-005]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, recuperacion]
---

# COM-012 · Almacén de borradores en IndexedDB

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
`@suite/platform` exporta `createIdbDraftStore()`: guardar, leer, borrar y listar borradores (valores clonables) en IndexedDB, para recuperar trabajo tras un cierre inesperado. Funciona igual en navegador y en el webview de Tauri.

## Contexto
- Leer: `packages/platform/src/errors.ts`, `src/prefs.ts`, [[ADR-0008-plataforma-ficheros]].
- Tests con `fake-indexeddb@6.2.6` (devDependency de `@suite/platform`): `import { IDBFactory } from 'fake-indexeddb'` y `new IDBFactory()` por test (aislado).

## Qué hay que hacer
1. `src/drafts.ts`:
   ```ts
   export interface DraftStore {
     put(key: string, value: unknown): Promise<void>;
     get(key: string): Promise<unknown>;      // undefined si no existe
     delete(key: string): Promise<void>;
     keys(): Promise<string[]>;               // orden alfabético
   }
   export function createIdbDraftStore(dbName: string, factory: IDBFactory | null = globalThis.indexedDB ?? null): DraftStore;
   ```
   - Base `dbName`, versión 1, *object store* `drafts` sin `keyPath` (clave explícita). La conexión se abre una vez (perezosa) y se reutiliza.
   - Cada operación en su transacción; resolver en `oncomplete` (escrituras) o `onsuccess` (lecturas).
   - Errores (`onerror`, `onblocked`, valor no clonable → `DataCloneError`) → rechaza con `PlatformIoError('io', { cause })`.
   - `factory === null` → implementación en memoria (`Map` con `structuredClone` del valor).
2. Exportar desde `src/index.ts`.
3. `package.json` de platform: `devDependencies` añade `"fake-indexeddb": "6.2.6"`.
4. Tests `tests/drafts.test.ts` (los mismos casos contra IndexedDB falso y contra memoria con `describe.each`).

## Criterios de aceptación
- [ ] (T) `put('a', { n: 1, list: [1,2] })` → `get('a')` igual en profundidad y **no** es el mismo objeto; `get('x')` → `undefined`.
- [ ] (T) `put` dos veces la misma clave sobrescribe; `delete` y luego `get` → `undefined`; `keys()` → `['a','b']` ordenado.
- [ ] (T) Persistencia: dos `createIdbDraftStore('db', mismaFactory)` comparten datos.
- [ ] (T) Valor no clonable (una función) → rechaza con `PlatformIoError` `io`.
- [ ] (T) Un `Uint8Array` de 1 MiB se guarda y se recupera igual.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `src/drafts.ts` ≥ 90 % de líneas.

## Fuera de alcance
- Cuándo y qué guarda cada app (PDF-038).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/platform/src/drafts.ts` (nuevo), `packages/platform/tests/drafts.test.ts` (nuevo), `packages/platform/src/index.ts` (2 exports), `packages/platform/package.json` (devDependency `fake-indexeddb@6.2.6`), `pnpm-lock.yaml` (solo sus entradas).
- Qué he hecho: `createIdbDraftStore(dbName, factory)` con IndexedDB (base versión 1, store `drafts` sin keyPath, conexión perezosa y reutilizada) y memoria con `factory === null`; errores de E/S, bloqueo y valores no clonables rechazan con `PlatformIoError('io')`. Robustez mínima añadida: si la apertura falla se reintenta en la siguiente operación, y si otra pestaña cambia la versión se cierra la conexión. Tests de los mismos casos contra IDB falso y memoria (`describe.each`) más casos específicos de IDB (persistencia, apertura fallida, bloqueo, versionchange, transacción síncrona fallida).
- Comandos ejecutados y resultado: `pnpm install` OK; `pnpm lint` 0; `pnpm typecheck` 0; `pnpm test` 0 (208 tests en la ejecución completa, 18 en drafts); `pnpm coverage` 0 (`drafts.ts` 100 % líneas, 82,35 % ramas).
- Dudas o cosas que no he podido hacer: (1) en `onblocked` el rechazo va **sin** `cause`, porque leer `request.error` con la petición pendiente lanza `InvalidStateError` (detectado por el test). (2) `keys()` ordena por código UTF-16 (orden por defecto de `sort`), no por locale, para que sea determinista. (3) `package.json` y `pnpm-lock.yaml` de la copia de trabajo llevan además dependencias `@tauri-apps/*` de otro programador en curso; no las he commiteado (commit solo con las líneas de `fake-indexeddb`).

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Lint, typecheck, test (257) y coverage en verde; `drafts.ts` 100 % líneas (ramas 82 %). Cada criterio tiene test (clonado, sobrescritura/orden, persistencia, no clonable, 1 MiB); errores como `PlatformIoError('io')`, reintento tras fallo de apertura y manejo de `versionchange`/bloqueo correctos. Sin problemas bloqueantes.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia |
|---|---|---|
| Clonado profundo, no mismo objeto, `get` inexistente → undefined | OK | `drafts.test.ts` (IDB y memoria) + `qa-drafts` mutar original tras put |
| Sobrescritura, delete, `keys()` ordenado | OK | `drafts.test.ts`; `qa-drafts` concurrencia (Promise.all de puts) |
| Persistencia entre dos stores con la misma factory | OK | `drafts.test.ts`; `qa-drafts` aislamiento por nombre de base |
| No clonable → `PlatformIoError` io | OK | `drafts.test.ts`; `qa-drafts` comprueba que no deja rastro y el store sigue usable |
| Uint8Array 1 MiB | OK | `drafts.test.ts`; `qa-drafts` 50 MiB OK |
| lint / typecheck / test / coverage | OK para COM-012 | lint 0, typecheck 0; `drafts.ts` 100 % líneas (96,42 % sentencias, ramas 82 %) |

Observación no atribuible a COM-012: en la ejecución completa en paralelo fallan por tiempo 2-3 tests de rendimiento de `apps/lector-pdf` (`layout.test.ts` 1 000 000 consultas <300 ms, `fixtures.test.ts` árbol 100 000 páginas timeout 5 s, `annotations/commands.test.ts` 2 s), lo que hace que `pnpm test`/`pnpm coverage` salgan con 1 bajo carga. Aislados pasan (188 tests). Son tests frágiles del PDF-001 en curso; conviene que el líder los revise (margen o excluir de la ejecución paralela).
Tests añadidos: `packages/platform/tests/qa-drafts.test.ts` (13: Unicode/RTL/clave vacía, falsy, Date/Map, concurrencia, 50 MiB, aislamiento).
Rendimiento: 50 MiB put+get dentro del timeout por defecto de Vitest (<5 s) en ambos backends.
