---
tipo: tarea
id: COM-007
titulo: Implementar guardar y guardar como en la Platform web
app: comun
estado: en-curso
depende_de: [COM-006]
intentos: 0
skills: [stack-typescript-react, stack-tauri, pruebas-calidad, calidad-profesional]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, platform, web]
---

# COM-007 · Guardar y guardar como en la Platform web

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0008-plataforma-ficheros]]

## Objetivo
`save` y `saveAs` de `createWebPlatform` escriben de forma atómica con `createWritable()` (Chromium) y, si no hay File System Access, descargan una copia. El modo `append` copia el original y añade el incremento **sin cargar el original en memoria**.

## Contexto
- Leer: `packages/platform/src/web/platform-web.ts`, `src/types.ts` (`SaveData`, `SaveOutcome`), [[ADR-0008-plataforma-ficheros]].
- `FileSystemWritableFileStream.write()` acepta `Blob` y `BufferSource`; escribir el `File` original como `Blob` evita leerlo entero. Chromium escribe en un fichero de intercambio y lo confirma en `close()` (atómico).
- Con TypeScript 7, `new Blob([u8])` puede exigir `Uint8Array<ArrayBuffer>`: si da error de tipos, usa `u8.slice()` (copia con `ArrayBuffer`) — no uses `as`.

## Qué hay que hacer
1. En `platform-web.ts`, función interna `async function writeTo(handle: PermissionHandle, data: SaveData): Promise<Result<File>>`:
   - Permiso: si `handle.queryPermission` existe y no devuelve `'granted'` para `{ mode: 'readwrite' }`, llama a `requestPermission`; si no queda `'granted'` → `err(platformError('permission-denied'))`.
   - Si `data.kind === 'append'`: busca `data.base.token` en el registro (no está → `err(platformError('not-found'))`); si `entry.file.size !== data.expectedSize` → `err(platformError('changed-on-disk'))`.
   - `const w = await handle.createWritable({ keepExistingData: false })`; `bytes` → `await w.write(bytes)`; `append` → `await w.write(baseFile)` y `await w.write(delta)`; `await w.close()`. Si algo lanza tras crear `w` → `await w.abort()` (ignorando su error) y `err(platformError('io', e))`.
   - Devuelve `ok(await handle.getFile())`.
2. `save(target, data)`: entrada del registro de `target.token`; sin entrada → `not-found`; sin `handle` → `err(platformError('save-in-place-unsupported'))`. Si `data.kind === 'append'` y `data.base.token === target.token`, además comprueba que `(await handle.getFile()).size === data.expectedSize` (si no → `changed-on-disk`). Tras escribir, actualiza la entrada con el `File` nuevo y devuelve `ok(OpenedFile)` con **el mismo token**, tamaño y `lastModified` nuevos y `source` nuevo.
3. `saveAs(name, filters, data)`:
   - Con `env.showSaveFilePicker`: `picker({ suggestedName: name, types: toAcceptTypes(filters) })`; `AbortError` → `ok({ kind: 'cancelled' })`; otros errores como en abrir. Registra un token nuevo, `writeTo`, y `ok({ kind: 'saved', file })` (`canSaveInPlace: true`).
   - Sin picker: `Blob` = `[bytes]` o `[baseFile, delta]` → `env.download(blob, name)` → `ok({ kind: 'downloaded', name })`. Para `append` comprueba antes `changed-on-disk` igual que en el paso 1.
4. Tests `tests/web/platform-web-save.test.ts` con un *handle* falso que guarda en memoria lo escrito y solo lo hace visible en `close()` (simula atomicidad), y un `download` falso.

## Criterios de aceptación
- [ ] (T) `save` de un fichero abierto con handle y `{ kind: 'bytes', bytes: [9,9] }` → `getFile()` del handle da `[9,9]`; el `OpenedFile` devuelto tiene el mismo `token`, `size 2` y su `source` lee `[9,9]`.
- [ ] (T) `append` sobre sí mismo: original `[1,2,3]`, `expectedSize 3`, delta `[4,5]` → contenido final `[1,2,3,4,5]`.
- [ ] (T) `append` con `expectedSize` distinto del tamaño actual → `err` `changed-on-disk` y el contenido no cambia.
- [ ] (T) Fallo en `write()` → se llama a `abort()`, `err` `io`, y el contenido visible sigue siendo el original.
- [ ] (T) Permiso denegado (`requestPermission` → `'denied'`) → `err` `permission-denied` sin crear el *writable*.
- [ ] (T) `save` de un fichero abierto con `openBrowserFile` → `err` `save-in-place-unsupported`.
- [ ] (T) `saveAs` con picker → `{ kind: 'saved' }` y token nuevo; picker cancelado → `{ kind: 'cancelled' }`; sin picker → `download` recibe un `Blob` cuyo contenido es base + delta y devuelve `{ kind: 'downloaded', name }`.
- [ ] (T) Memoria: en `append` el `File` base se pasa a `write()` como `Blob` (el test verifica que la primera escritura es el mismo objeto `File`, no un `Uint8Array`).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage` con código 0; `packages/platform/src/web` ≥ 85 % de líneas.

## Fuera de alcance
- Guardado automático y borradores (COM-012). Tauri (COM-010).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
