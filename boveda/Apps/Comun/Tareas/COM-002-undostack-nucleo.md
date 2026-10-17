---
tipo: tarea
id: COM-002
titulo: Implementar el núcleo de UndoStack (historial, límite, guardado)
app: comun
estado: hecha
depende_de: [COM-001]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, undo]
---

# COM-002 · Implementar el núcleo de UndoStack (historial, límite, guardado)

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0005-modelo-deshacer-rehacer]] · [[ADR-0006-eslint]] · [[ADR-0004-herramientas-monorepo]] · Investigación: [[Deshacer y rehacer en editores]]

## Objetivo
Existe `UndoStack<D>` en `@suite/shared` con ejecutar, deshacer, rehacer, límite de historial, marca de guardado, estado para la UI y suscripción. **Sin agrupación** (cada `execute` = una entrada; la agrupación es COM-003).

## Contexto
- Leer: [[ADR-0005-modelo-deshacer-rehacer]] (sobre todo el párrafo "Guardado"), `packages/shared/src/index.ts`, `vitest.config.ts`.
- Lógica pura: nada de DOM, Node, `console.*` ni dependencias nuevas.
- El lint (`tseslint.configs.strict`) prohíbe el operador `!` (`no-non-null-assertion`): con `noUncheckedIndexedAccess`, estrecha con `if (x === undefined) ...` (p. ej. en `#trim()`, `if (removed === undefined) break;`).

## Qué hay que hacer
1. `packages/shared/src/undo/types.ts` (exactamente estos tipos):
   ```ts
   export interface Command<D> {
     /** Texto en español para "Deshacer <label>", p. ej. "escribir". */
     readonly label: string;
     /** Clave de agrupación (la usa COM-003). Sin clave = nunca se agrupa (pegar, cortar, IME). */
     readonly mergeKey?: string;
     apply(doc: D): D;
     /** Devuelve el comando que deshace este, dado el documento ANTES de aplicarlo. */
     invert(before: D): Command<D>;
   }
   export interface UndoStackOptions {
     readonly maxDepth?: number;      // por defecto 100; 0 = sin historial
     readonly groupDelayMs?: number;  // por defecto 500 (lo usa COM-003)
     readonly now?: () => number;     // por defecto Date.now (para tests)
   }
   export interface UndoState {
     readonly canUndo: boolean;
     readonly canRedo: boolean;
     readonly undoLabel: string | null;  // label de la entrada superior de deshacer
     readonly redoLabel: string | null;
     readonly undoDepth: number;
     readonly redoDepth: number;
     readonly isDirty: boolean;
   }
   export type UndoListener = (state: UndoState) => void;
   ```
2. `packages/shared/src/undo/undo-stack.ts`: `export class UndoStack<D>` con campos privados `#`:
   - Internos (no exportados): `interface Step<D> { readonly forward: Command<D>; readonly inverse: Command<D> }` e `interface Entry<D> { readonly id: number; label: string; mergeKey: string | undefined; readonly steps: Step<D>[]; lastTime: number }`.
   - Estado: `#doc`, `#undo: Entry<D>[]`, `#redo: Entry<D>[]`, `#nextId = 1`, `#baseId = 0`, `#savedId = 0`, `#maxDepth`, `#groupDelayMs`, `#now`, `#busy = false`, `#listeners = new Set<UndoListener>()`.
   - `#topId()` = `id` de la última entrada de `#undo`, o `#baseId` si está vacía.
   - `constructor(initial: D, options: UndoStackOptions = {})`: valida `maxDepth` (entero ≥ 0) y `groupDelayMs` (finito ≥ 0); si no, `throw new RangeError('maxDepth debe ser un entero >= 0')` / `'groupDelayMs debe ser un número >= 0'`.
   - `get doc(): D`.
   - `execute(cmd: Command<D>): D`: si `#busy` → `throw new Error('UndoStack: reentrada no permitida')`. Con `#busy = true` (liberar en `finally`): `inverse = cmd.invert(doc)`, `next = cmd.apply(doc)`. Si algo lanza, el doc y las pilas quedan **intactos**. Después: `#doc = next`, vaciar `#redo`, apilar `{ id: #nextId++, label: cmd.label, mergeKey: cmd.mergeKey, steps: [{forward: cmd, inverse}], lastTime: #now() }`, `#trim()`, notificar, devolver `#doc`.
   - `undo(): boolean`: si vacío → `false` sin notificar. Si no: calcula el nuevo doc aplicando los `inverse` de la entrada en orden **inverso** (en variable local, con `#busy`); solo si no lanza, mueve la entrada a `#redo`, asigna el doc, notifica y devuelve `true`.
   - `redo(): boolean`: simétrico, aplicando los `forward` en orden.
   - `#trim()`: mientras `#undo.length > #maxDepth`: `const removed = #undo.shift()`; `#baseId = removed.id`.
   - `setMaxDepth(n: number): void`: misma validación, asigna, `#trim()`, notifica.
   - `markSaved(): void`: `#savedId = #topId()`, notifica.
   - `isDirty(): boolean`: `#topId() !== #savedId`.
   - `clear(): void`: `#baseId = #topId()`, vacía ambas pilas, notifica (el estado sucio no cambia).
   - `getState(): UndoState`.
   - `subscribe(listener: UndoListener): () => void`: devuelve la función para darse de baja. Notificar = llamar a cada listener, en orden de alta, con `getState()`.
   - `undo`/`redo`/`markSaved`/`clear`/`setMaxDepth` también lanzan el error de reentrada si `#busy`.
3. `packages/shared/src/undo/index.ts`: `export type { Command, UndoStackOptions, UndoState, UndoListener } from './types'; export { UndoStack } from './undo-stack';`
4. `packages/shared/src/index.ts`: añade `export * from './undo';` (deja `SHARED_PACKAGE_NAME`).
5. `packages/shared/tests/undo/text-commands.ts` (ayuda de tests, D = `string`):
   ```ts
   import type { Command } from '../../src/undo';
   export function insertText(pos: number, text: string, mergeKey?: string): Command<string> {
     return {
       label: 'escribir',
       ...(mergeKey === undefined ? {} : { mergeKey }),
       apply: (doc) => doc.slice(0, pos) + text + doc.slice(pos),
       invert: () => deleteText(pos, text.length),
     };
   }
   export function deleteText(pos: number, length: number): Command<string> {
     return {
       label: 'borrar',
       apply: (doc) => doc.slice(0, pos) + doc.slice(pos + length),
       invert: (before) => insertText(pos, before.slice(pos, pos + length)),
     };
   }
   ```
6. `packages/shared/tests/undo/undo-stack.test.ts` con un `it` por cada criterio de abajo marcado (T).

## Criterios de aceptación
- [ ] (T) Identidad: con doc `'hola'`, `execute(insertText(4, ' mundo'))` → `doc === 'hola mundo'`; `undo()` → `'hola'`; `redo()` → `'hola mundo'`. Igual con `deleteText(0, 2)` (`'la'` ↔ `'hola'`).
- [ ] (T) `undo()`/`redo()` sin nada devuelven `false` y no llaman al listener.
- [ ] (T) Ejecutar tras deshacer vacía el redo: `execute A, undo, execute B` → `canRedo === false`.
- [ ] (T) Límite: `maxDepth: 3`, 5 `execute` → `undoDepth === 3`; tras 3 `undo()` el cuarto devuelve `false` y el doc es el de después del 2.º comando.
- [ ] (T) `maxDepth: 0`: el doc cambia, `canUndo === false`, `isDirty() === true`.
- [ ] (T) `setMaxDepth(1)` con 3 entradas deja `undoDepth === 1`. `new UndoStack('', { maxDepth: -1 })` y `{ maxDepth: 1.5 }` lanzan `RangeError`; `{ groupDelayMs: Number.NaN }` también.
- [ ] (T) Guardado: nuevo → `isDirty() === false`; `execute` → `true`; `undo` → `false`; `redo` → `true`; `markSaved` → `false`; `execute`, `undo` → `false`.
- [ ] (T) Guardado inalcanzable por rama: `execute A, markSaved, undo, execute B` → `isDirty() === true`; tras `undo()` sigue `true` (el estado inicial no es el guardado); tras `redo()` sigue `true`.
- [ ] (T) Guardado recortado: `maxDepth: 2`, `markSaved()` con la pila vacía, 3 `execute`, 2 `undo` → `isDirty() === true` (ya no se puede volver al estado guardado).
- [ ] (T) Guardado en la base tras recorte: `maxDepth: 2`, `execute` ×1, `markSaved`, `execute` ×2 (recorta la entrada guardada), 2 `undo` → `isDirty() === false`.
- [ ] (T) `clear()` conserva sucio: `execute`, `clear()` → `canUndo === false`, `isDirty() === true`; con `markSaved` previo → `false`.
- [ ] (T) `getState()` tras `execute(insertText(0,'a'))` es exactamente `{ canUndo: true, canRedo: false, undoLabel: 'escribir', redoLabel: null, undoDepth: 1, redoDepth: 0, isDirty: true }`.
- [ ] (T) `subscribe`: el listener recibe el estado en `execute`, `undo`, `redo`, `markSaved`, `clear`, `setMaxDepth`; tras darse de baja no se le llama.
- [ ] (T) Errores: si `apply` lanza, `execute` propaga el error y `doc`, `undoDepth` y `isDirty()` no cambian. Un comando cuyo `apply` llama a `stack.execute(...)` provoca `Error` con mensaje `'UndoStack: reentrada no permitida'`.
- [ ] (T) Rendimiento: con D = `number` y `maxDepth: 100`, 100 000 `execute` de "sumar 1" terminan en < 1000 ms (medir con `performance.now()`); el doc final es `100000` y `undoDepth === 100`. Anotar el tiempo medido en el Registro.
- [ ] `pnpm lint` con código 0 (sin errores ni avisos; nada de `eslint-disable`); `pnpm typecheck` sin errores; `pnpm test` todo en verde; `pnpm coverage` ≥ 80 % de líneas y `undo-stack.ts` ≥ 90 % de líneas (verlo en la tabla de cobertura).
- [ ] Sin `any`, `@ts-ignore`, `console.*`, `test.skip` ni `.only`. Ningún `throw` salvo los de bug/validación descritos.

## Fuera de alcance
- Agrupación (`mergeKey`, tiempo, `group()`, `closeGroup()`): COM-003. Aquí `mergeKey` y `groupDelayMs` solo se guardan.
- UI, atajos de teclado, React. No cambiar `package.json` ni la configuración de COM-001.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/shared/src/undo/types.ts`, `packages/shared/src/undo/undo-stack.ts`, `packages/shared/src/undo/index.ts`, `packages/shared/src/index.ts` (añade `export * from './undo'`), `packages/shared/tests/undo/text-commands.ts`, `packages/shared/tests/undo/undo-stack.test.ts`.
- Qué he hecho: implementado `UndoStack<D>` según la ficha (ejecutar, deshacer, rehacer, límite, guardado por ids, `clear`, `getState`, `subscribe`, reentrada con `#busy`). Tests: un `it` por criterio (T), 17 tests en total entre `undo-stack.test.ts` y el smoke test de COM-001.
- Decisión menor a revisar: `groupDelayMs` queda guardado en `#groupDelayMs` y lo expongo con un getter público `groupDelayMs` (sin él, `no-unused-private-class-members` da error de lint). Es de solo lectura y lo usará COM-003.
- Comandos ejecutados y resultado: `pnpm lint` → código 0, sin avisos. `pnpm typecheck` → sin errores. `pnpm test` → 2 ficheros, 17 tests en verde. `pnpm coverage` → 100 % de líneas en total y en `undo-stack.ts` (umbral ≥ 90 % cumplido; ramas 96.5 %).
- Rendimiento medido (100 000 `execute` de "sumar 1", `maxDepth: 100`): bucle de ~55–70 ms en 4 ejecuciones (duración del test en el reporter verbose: 56–71 ms; umbral 1000 ms).
- Dudas o cosas que no he podido hacer (programador): el test de rendimiento usa `performance.now()` a través de `globalThis` porque tsconfig no incluye tipos DOM ni de Node y no se añaden dependencias. Un `it` con tiempo medido puede ser sensible a la carga de la máquina; el umbral es amplio (1000 ms frente a ~60 ms).

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint` 0, `pnpm typecheck` sin errores, `pnpm test` 17 en verde, cobertura 100 % de líneas (`undo-stack.ts` 100 %). Cada criterio (T) tiene su test; sin `any`, `console.*`, `eslint-disable`, `skip`/`only`. Cambio limitado a los ficheros de la ficha.
1. (opcional) `packages/shared/src/undo/undo-stack.ts:46` — getter público `groupDelayMs` fuera de la ficha: ACEPTABLE. Es de solo lectura, mínimo, el lint prohíbe un miembro privado sin uso y la ficha exige guardar el valor; está declarado y probado. No se pide corregirlo. COM-003 podría eliminarlo al usar `#groupDelayMs` internamente, para no ampliar la API pública sin necesidad.

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| Criterios (T) de comportamiento (identidad, vacío, redo, límite, maxDepth 0, validación, guardado ×4, clear, getState, subscribe, errores) | OK | `pnpm test` → 3 ficheros, 29 tests en verde (17 originales + 12 míos) |
| Rendimiento 100 000 execute < 1000 ms | OK | 63, 61 y 60 ms en 3 ejecuciones (`vitest --reporter=verbose`) |
| lint / typecheck | OK | `pnpm lint` código 0 (--max-warnings 0); `pnpm typecheck` código 0 |
| Cobertura | OK | `pnpm coverage`: 100 % líneas total y en `undo-stack.ts` (ramas 96.55 %) |
| Sin any/ts-ignore/console/skip/only/eslint-disable | OK | `grep` sin coincidencias en `packages/shared/src` y `tests` |

Casos límite adicionales (todos sin fallos): maxDepth 0 con undo/redo/markSaved; redo tras execute; `invert` que lanza (doc y pilas intactos, pila no queda bloqueada); inverso que lanza en `undo` y `apply` que lanza en `redo` (entrada se conserva y se puede reintentar); reentrada desde undo/redo/markSaved/clear/setMaxDepth dentro de `apply`; baja de listener durante la notificación; setMaxDepth(0)/negativo/NaN; Infinity en opciones; Unicode (ñ, emoji, RTL); clear con el estado guardado en el redo.
Observaciones no bloqueantes: un listener que lanza interrumpe la notificación a los siguientes (no especificado en la ficha); el getter público `groupDelayMs` ya señalado por el revisor.
Tests añadidos: `packages/shared/tests/undo/undo-stack.edge.test.ts` (12).   Rendimiento: ~60 ms.
