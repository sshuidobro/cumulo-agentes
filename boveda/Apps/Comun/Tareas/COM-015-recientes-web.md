---
tipo: tarea
id: COM-015
titulo: Documentos recientes en @suite/platform - tipos e implementación web
app: comun
estado: pendiente
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
