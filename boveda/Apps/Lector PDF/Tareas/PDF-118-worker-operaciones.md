---
tipo: tarea
id: PDF-118
titulo: Worker de operaciones de documento con lectura por mensajes
app: pdf
estado: en-test
depende_de: [PDF-052]
intentos: 0
skills: [stack-typescript-react, stack-tauri, calidad-profesional, pruebas-calidad]
creado: 2026-10-19
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, worker, rendimiento]
---

# PDF-118 · Worker de operaciones de documento con lectura por mensajes

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Decisiones: [[ADR-0034-operaciones-en-worker]], [[ADR-0028-reescribir-pdfs]] · Lo usan: [[PDF-124-organizar-estado]] y el resto de operaciones de las iteraciones 5-6

## Objetivo
Ejecutar funciones del núcleo (`core/`) en un Web Worker con progreso, cancelación y lectura por rangos del fichero abierto a través del hilo principal, igual en web y en Tauri. Primera operación registrada: `page-rotations` (giros efectivos de todas las páginas).

## Contexto
- [[ADR-0034-operaciones-en-worker]] (protocolo y reglas).
- `packages/platform/src/types.ts` → `ByteSource`; `memorySource` de `@suite/platform`.
- `src/core/pdf/incremental.ts` → `openForSave` (abre con contraseña y devuelve `Result`).
- `src/core/pdf/page-tree.ts` → `readPageRotations`.
- `src/core/errors.ts` → `pdfError('cancelled')`. `AppError` en `packages/shared/src/result.ts`.
- `vite.config.ts` ya tiene `worker: { format: 'es' }`; CSP con `worker-src 'self' blob:`.

## Qué hay que hacer
1. `src/core/doc-ops/protocol.ts` (solo tipos y constantes):
```ts
import type { AppError, Result } from '@suite/shared';
export type SourceSpec = { readonly kind: 'remote'; readonly size: number } | { readonly kind: 'bytes'; readonly bytes: Uint8Array };
export type ToWorker =
  | { readonly type: 'run'; readonly id: number; readonly op: string; readonly args: unknown; readonly sources: readonly SourceSpec[] }
  | { readonly type: 'cancel'; readonly id: number }
  | { readonly type: 'read-result'; readonly req: number; readonly bytes: Uint8Array }
  | { readonly type: 'read-error'; readonly req: number; readonly message: string };
export type FromWorker =
  | { readonly type: 'read'; readonly req: number; readonly id: number; readonly source: number; readonly begin: number; readonly end: number }
  | { readonly type: 'progress'; readonly id: number; readonly done: number; readonly total: number }
  | { readonly type: 'done'; readonly id: number; readonly result: Result<unknown, AppError> };
/** Lo mínimo de `MessagePort`/`Worker`/`self` que usan cliente y servidor. */
export interface PortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void): void;
}
export interface OpContext {
  readonly sources: readonly ByteSource[];
  readonly signal: AbortSignal;
  progress(done: number, total: number): void;
}
export type DocOp = (args: unknown, ctx: OpContext) => Promise<Result<unknown, AppError>>;
export type DocOpRegistry = Readonly<Record<string, DocOp>>;
```
2. `src/core/doc-ops/server.ts` → `export function serveDocOps(port: PortLike, registry: DocOpRegistry): () => void` (devuelve la baja):
   - `run`: crea `AbortController`; las fuentes `remote` son `ByteSource` cuyo `read` envía `read` (id de petición creciente) y espera `read-result`/`read-error` (este último → rechaza con `Error(message)`); las `bytes` son `memorySource(bytes)`. Op desconocida → `done` con `err({ code: 'io', message: 'Operación desconocida.' })`.
   - El resultado de la op se envía en `done`; si es `ok` y su `value` es o contiene en primer nivel un `Uint8Array` (propiedad de un objeto), se transfiere su `buffer`. Una excepción de la op → `err({ code: 'io', message: PDF_ERROR_MESSAGES.io })` y se registra con el logger. Nunca se envía `cause`.
   - `progress` de la op → mensaje `progress` como mucho cada 100 ms (y siempre el último con `done === total`).
   - `cancel` → aborta el controlador de ese `id` (la op devuelve `cancelled`).
3. `src/core/doc-ops/client.ts`:
```ts
export interface RunOptions { readonly signal?: AbortSignal; readonly onProgress?: (done: number, total: number) => void }
export type SourceInput = ByteSource | Uint8Array;
export interface DocOpsClient {
  run<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>>;
  dispose(): void;
}
export function createDocOpsClient(port: PortLike): DocOpsClient;
```
   - `Uint8Array` → `{ kind: 'bytes' }` (se transfiere una copia: `bytes.slice()`); `ByteSource` → `{ kind: 'remote', size }` y responde a `read` con `source.read(begin, end)` (`read-error` con el mensaje si falla).
   - `signal` abortado antes → `err(pdfError('cancelled'))` sin enviar nada; abortado durante → envía `cancel` y espera `done`.
4. `src/core/doc-ops/ops/index.ts` → `export const DOC_OPS: DocOpRegistry` con `'page-rotations'`: args `{ password: string | null }`, fuente 0 = documento; `openForSave` + `readPageRotations` → `ok(readonly PageRotation[])`.
5. `src/workers/doc-ops.worker.ts`: `serveDocOps(self as unknown as PortLike, DOC_OPS);` (con el comentario del motivo del `as`).
6. `src/state/doc-ops.ts`:
```ts
export function runDocOp<T>(op: string, args: unknown, sources: readonly SourceInput[], opts?: RunOptions): Promise<Result<T, AppError>>;
/** Tests: ejecuta en el mismo hilo con un MessageChannel (sin Worker). `null` vuelve al Worker real. */
export function setDocOpsRunner(runner: DocOpsClient | null): void;
export function inProcessDocOps(): DocOpsClient;   // MessageChannel + serveDocOps(DOC_OPS)
```
   El Worker real se crea en la primera llamada con `new Worker(new URL('../workers/doc-ops.worker.ts', import.meta.url), { type: 'module' })` y se reutiliza. Si `Worker` no existe (jsdom) se usa `inProcessDocOps()`.
7. Tests:
   - `tests/unit/doc-ops/protocol.test.ts` (Node, `MessageChannel` de `node:worker_threads` adaptado a `PortLike`): op de prueba que lee de una fuente remota y suma bytes; progreso; cancelar a mitad; op desconocida; op que lanza; fuente que falla en `read` → `done` con error y sin `cause`.
   - `tests/unit/doc-ops/page-rotations.test.ts`: `basic-5.pdf` → `[0,0,0,0,0]`; `encrypted-aes-256.pdf` con `usuario` → 5 giros; contraseña mala → `save-wrong-password`.
   - El Worker real (sin gancho de pruebas: los e2e usan el build de producción) lo prueban los e2e de [[PDF-126-organizar-arrastrar-e2e]] (guardar en `pages-5000.pdf` sin *long tasks*).

## Criterios de aceptación
- [ ] Los tests anteriores pasan; `page-rotations` sobre `pages-100000.pdf` por el cliente en el mismo hilo (`tests/perf/doc-ops.perf.test.ts`) < 4 000 ms (mejor de 3, `pnpm perf`).
- [ ] Ninguna lectura de fuente remota pide fuera de `[0, size)`; `read-error` llega a la op como rechazo y al cliente como `err` con mensaje en español.
- [ ] `pnpm --filter lector-pdf build` genera un *chunk* separado para el Worker y `bundle:check` sigue dentro del presupuesto.
- [ ] `core/doc-ops/` no importa React, `pdfjs-dist` ni `@tauri-apps/*` (lint).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm coverage` con código 0.

## Fuera de alcance
- Operaciones concretas distintas de `page-rotations` (las añade cada ficha en `ops/index.ts`). Varios Workers en paralelo. pdf.js y tesseract.js (tienen su propio Worker).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `apps/lector-pdf/src/core/doc-ops/{protocol,bytes,server,client}.ts`, `apps/lector-pdf/src/core/doc-ops/ops/index.ts`, `apps/lector-pdf/src/workers/doc-ops.worker.ts`, `apps/lector-pdf/src/state/doc-ops.ts`, `apps/lector-pdf/tests/unit/doc-ops/{protocol,page-rotations}.test.ts`, `apps/lector-pdf/tests/perf/doc-ops.perf.test.ts`, esta ficha.
- Qué he hecho: protocolo, servidor (Worker) y cliente con lecturas por rangos (validadas en `[0, size)` a ambos lados), progreso throttled a 100 ms, cancelación y errores sin `cause`. Registrada `page-rotations` y ejecutor `runDocOp` / `setDocOpsRunner` / `inProcessDocOps`. Fuente en memoria local (`bytesSource`) en vez de `memorySource` para no arrastrar `@suite/platform` (con `detect` y el Worker) al chunk del Worker.
- Comandos ejecutados y resultado: `pnpm exec vitest run tests/unit/doc-ops` → 13 tests OK. `pnpm exec vitest run --config vitest.perf.config.ts apps/lector-pdf/tests/perf/doc-ops.perf.test.ts` → OK (tiempo no registrado; umbral 4 000 ms). `pnpm typecheck` → OK. `pnpm lint` → falla por dos `no-console` en `apps/lector-pdf/tests/unit/tabs-annotations.test.ts` (líneas 94 y 217, fichero ajeno a esta ficha); mis ficheros pasan eslint con `--max-warnings 0`. `pnpm coverage` → 5 tests rojos en `tests/unit/tabs-annotations.test.ts` y `tests/ui/draft-sync-tabs.test.tsx` (también fallan al ejecutarse solos; no importan `doc-ops`); el resto OK. `pnpm --filter lector-pdf build` → falla `bundle:check`: arranque 546 316 bytes > 500 000.
- Dudas o cosas que no he podido hacer:
  - Criterio «el build genera un chunk separado para el Worker»: hoy nada importa `state/doc-ops.ts`, así que el Worker no entra en el grafo y no se emite. Comprobado con un build de sonda (temporal, borrado): Vite emite `doc-ops.worker-*.js` (~61 kB) cuando se importa `runDocOp`. Se cumplirá al llegar el primer consumidor (PDF-124).
  - El fallo de `bundle:check` no viene de estos ficheros (no están en el arranque). Revisar el arranque con los cambios en curso de otras fichas (`core/pdf/incremental.ts` modificado, `core/pdf/object-copier.ts` nuevo).
  - No he hecho commit (pedido explícito).
