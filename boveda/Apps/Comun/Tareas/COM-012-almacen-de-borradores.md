---
tipo: tarea
id: COM-012
titulo: Crear el almacén de borradores en IndexedDB (DraftStore)
app: comun
estado: pendiente
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
