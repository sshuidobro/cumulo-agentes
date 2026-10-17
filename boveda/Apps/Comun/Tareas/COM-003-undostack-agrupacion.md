---
tipo: tarea
id: COM-003
titulo: Añadir agrupación de cambios a UndoStack
app: comun
estado: hecha
depende_de: [COM-002]
intentos: 0
skills: [stack-typescript-react, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, comun, undo]
---

# COM-003 · Añadir agrupación de cambios a UndoStack

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0005-modelo-deshacer-rehacer]] · [[ADR-0006-eslint]] · Investigación: [[Deshacer y rehacer en editores]]

## Objetivo
Teclear varias letras seguidas se deshace de una vez: agrupación automática por `mergeKey` + tiempo, agrupación explícita con `group()` (anidable, se anula entera si falla) y corte manual con `closeGroup()`.

## Contexto
- Leer: `packages/shared/src/undo/types.ts`, `packages/shared/src/undo/undo-stack.ts`, `packages/shared/tests/undo/text-commands.ts`, `packages/shared/tests/undo/undo-stack.test.ts` (los tests de COM-002 deben seguir pasando sin cambios).
- Sin operador `!` (lo prohíbe el lint, ver [[ADR-0006-eslint]]): estrecha con `if (x === undefined) ...`.
- Agrupar = **añadir un paso** (`{forward, inverse}`) a la entrada superior; nunca fusionar comandos. La entrada conserva su `id`, `label` y `mergeKey` originales.

## Qué hay que hacer
Solo en `undo-stack.ts` (y tests nuevos):
1. Campos nuevos: `#closed = true`, `#groupDepth = 0`, `#groupLabel = ''`, `#groupEntry: Entry<D> | null = null`, `#groupDocBefore: D` (inicialízalo en el constructor con `initial`) y `#groupRedoBefore: Entry<D>[] = []`; ambos se reasignan al abrir el grupo exterior.
2. `execute(cmd)`: tras calcular `inverse` y `next` (igual que ahora), decide dónde va el paso:
   - **Dentro de `group()`** (`#groupDepth > 0`): si `#groupEntry` es `null`, crea la entrada (`label: #groupLabel`, `mergeKey: undefined`), vacía `#redo` y apílala; si no, añade el paso a `#groupEntry`. **No** recortes ni notifiques aquí.
   - **Fuera**: agrupa con la entrada superior `top` si y solo si `!#closed && cmd.mergeKey !== undefined && top !== undefined && top.mergeKey === cmd.mergeKey && #now() - top.lastTime <= #groupDelayMs`. Si agrupa: añade el paso y `top.lastTime = #now()`. Si no: comportamiento de COM-002 (entrada nueva). En ambos casos vacía `#redo`, `#closed = false`, `#trim()`, notifica.
3. `#closed = true` al final de `undo()` (si devolvió `true`), `redo()` (ídem), `markSaved()`, `clear()` y al cerrar un `group()` con entrada. Así nunca se añaden pasos a la entrada que marca el guardado.
4. `closeGroup(): void` → `#closed = true` (sin notificar). Uso: cambio de selección, pegar, cortar, perder el foco.
5. `group<T>(label: string, fn: () => T): T`:
   - Si `#busy` → error de reentrada. `#groupDepth++`. Si es el exterior (`=== 1`): guarda `#groupLabel = label`, `#groupEntry = null`, `#groupDocBefore = #doc`, `#groupRedoBefore = [...#redo]`.
   - `try { const result = fn(); ... return result; } catch (e) { ... throw e; } finally { #groupDepth--; }`.
   - Fin normal del exterior: si `#groupEntry !== null` → `#closed = true`, `#trim()`, notifica. Si es `null` (grupo vacío) → nada (ni entrada ni notificación).
   - Excepción que sale del exterior: `#doc = #groupDocBefore`; si `#groupEntry !== null`, quítala de `#undo` (es la última); `#redo = #groupRedoBefore`; `#groupEntry = null`; relanza. Sin notificar. Un error que `fn` atrapa dentro no anula nada.
   - Los grupos internos solo ejecutan `fn` (su `label` se ignora): todo cae en la entrada del exterior.
6. Dentro de un `group()`, `undo`, `redo`, `markSaved`, `clear` y `setMaxDepth` lanzan `new Error('UndoStack: operación no permitida dentro de group()')`.
7. Tests en `packages/shared/tests/undo/undo-stack-grouping.test.ts`, usando `now` falso (`let t = 0; const now = () => t;`), un `it` por criterio (T).

## Criterios de aceptación
- [ ] (T) Teclear agrupa: doc `''`, `insertText(0, 'h', 'typing')` en `t = 0`, `insertText(1, 'o', 'typing')` en `t = 100`, `insertText(2, 'la', 'typing')` en `t = 200` → `doc === 'hola'`, `undoDepth === 1`, `undoLabel === 'escribir'`; un `undo()` → `''`; un `redo()` → `'hola'`.
- [ ] (T) Ventana de tiempo: pasos en `t` = 0 y 501 (por defecto 500 ms) → `undoDepth === 2`; en `t` = 0 y 500 → `1`. Con `groupDelayMs: 0` y mismo `t` → `1`.
- [ ] (T) Clave distinta o ausente no agrupa: `mergeKey 'typing'` seguido de `'delete'` → 2 entradas; dos comandos sin `mergeKey` en el mismo `t` → 2 entradas.
- [ ] (T) `closeGroup()` entre dos letras `'typing'` en el mismo `t` → 2 entradas.
- [ ] (T) Tras `undo()` + `redo()`, la siguiente letra `'typing'` en el mismo `t` abre entrada nueva.
- [ ] (T) Guardado y agrupación: `'a'` (typing), `markSaved()`, `'b'` (typing, mismo `t`) → `undoDepth === 2`, `isDirty() === true`; `undo()` → `isDirty() === false` y `doc === 'a'`.
- [ ] (T) `group('reemplazar', ...)` con `deleteText` + `insertText` → 1 entrada con `undoLabel === 'reemplazar'`; `undo()` restaura el doc original; `redo()` vuelve al resultado; el listener se llama **una sola vez** durante el grupo.
- [ ] (T) Grupos anidados: `group('exterior', () => { execute A; group('interior', () => execute B); })` → 1 entrada, `undoLabel === 'exterior'`.
- [ ] (T) Grupo vacío (anidado o no): `undoDepth` sin cambios, listener no llamado, `isDirty()` sin cambios.
- [ ] (T) Anulación: con doc `'x'` y una entrada previa deshecha (`canRedo === true`), un `group` que ejecuta `insertText` y luego lanza `new Error('fallo')` → `group` relanza ese error; `doc === 'x'`, `undoDepth` igual que antes, `canRedo === true`.
- [ ] (T) `group` devuelve el valor de `fn` (`group('g', () => 42) === 42`).
- [ ] (T) `undo()` y `markSaved()` dentro de `group` lanzan `Error` con el mensaje `'UndoStack: operación no permitida dentro de group()'`.
- [ ] (T) Una letra `'typing'` justo después de cerrar un `group` (mismo `t`) no se mete en la entrada del grupo.
- [ ] (T) Límite con agrupación: `maxDepth: 2`, tres grupos de tecleo separados por `closeGroup()` → `undoDepth === 2`.
- [ ] Todos los tests de COM-002 siguen pasando **sin modificarlos**.
- [ ] `pnpm lint` con código 0 (sin errores ni avisos; nada de `eslint-disable`); `pnpm typecheck` sin errores; `pnpm test` en verde; `pnpm coverage` ≥ 80 % de líneas y `undo-stack.ts` ≥ 90 %.
- [ ] Sin `any`, `@ts-ignore`, `console.*`, `test.skip` ni `.only`; sin dependencias nuevas.

## Fuera de alcance
- `Command.merge` (comprimir pasos), detección de IME o de "solo selección": eso lo decide quien crea el comando (omitiendo `mergeKey` o llamando a `closeGroup()`).
- UI, atajos, React. No cambiar `types.ts` salvo para añadir JSDoc.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-17
- Ficheros cambiados: `packages/shared/src/undo/undo-stack.ts` (agrupación, `group`, `closeGroup`, rollback); `packages/shared/tests/undo/undo-stack-grouping.test.ts` (nuevo, 15 tests); `packages/shared/tests/undo/undo-stack.test.ts` (quitadas las 2 aserciones del getter `groupDelayMs`, el resto intacto).
- Qué he hecho: implementado la agrupación según la ficha: `mergeKey` + ventana de tiempo, `group()` anidable con anulación si `fn` lanza, `closeGroup()` y cortes de agrupación en undo/redo/markSaved/clear. Un `it` por criterio (T), más un test de `groupDelayMs` personalizado.
- Decisión sobre el getter de COM-002 (pedida por el revisor): **retirado** el getter público `groupDelayMs`. Ahora `execute` usa `#groupDelayMs`, así que el lint ya no lo marca como sin uso. La aserción del valor por defecto (500) y del valor guardado (250) se cubre por comportamiento en `undo-stack-grouping.test.ts` (ventana 500 inclusiva y ventana 250). No amplía la API pública.
- Comandos ejecutados y resultado: `pnpm lint` → código 0 (`--max-warnings 0`). `pnpm typecheck` → código 0. `pnpm test` → 4 ficheros, 45 tests en verde. `pnpm coverage` → 100 % de líneas (`undo-stack.ts` 100 % líneas, ramas 94.44 %); umbral ≥ 90 % cumplido.
- Dudas o cosas que no he podido hacer (ver revisión abajo): (1) el rollback de un `group` que falla no toca `#closed`, siguiendo la ficha al pie de la letra; si el cambio previo al grupo era abierto, una letra posterior en el mismo instante puede agruparse con él, lo cual es coherente con el tiempo. (2) `closeGroup()` no comprueba si se llama dentro de `group()`; la ficha no lo pide y es inocuo. (3) `text-commands.ts` no admite `mergeKey` en `deleteText`; el test de clave distinta usa `{ ...deleteText(...), mergeKey }` para no tocar el helper.

### [revisor] ronda 1 — 2026-10-17 — APROBADO
Comprobado: `pnpm lint`, `typecheck`, `test` (45 en verde) y `coverage` (líneas 100 %, `undo-stack.ts` ramas 94,44 %) sin errores. Todos los criterios (T) tienen su test y cubren lo pedido; sin `any`, `!`, `console` ni `skip`.
Los tres puntos del programador:
1. Rollback y `#closed`: correcto. Al anular, `#doc` y `#redo` vuelven al estado previo y la entrada superior es de nuevo la anterior al grupo; dejar `#closed` como estaba es coherente con ese estado (y es lo que dice la ficha). Un error atrapado dentro de `fn` no anula nada, y los fallos en `apply` dentro del grupo no dejan `#busy` colgado.
2. `closeGroup()` dentro de `group()`: inocuo. Dentro del grupo `#closed` no se lee y el cierre del grupo ya lo pone a `true`. Aceptado.
3. `deleteText` sin `mergeKey`: el spread `{ ...deleteText(), mergeKey }` en el test es válido y evita tocar el helper. Aceptado.
Retirada del getter `groupDelayMs`: aceptada. Era la sugerencia (opcional) del revisor de COM-002, reduce la API pública y el comportamiento queda cubierto por los tests de ventana (500 inclusiva, 250, 0). La eliminación de las 2 aserciones de `undo-stack.test.ts` es la única modificación a un test de COM-002 y es inevitable (probaban el getter retirado); el resto está intacto. Queda en el historial git.
Sugerencias (opcional, no bloquean):
- `undo-stack.ts:269` — la guarda `this.#undo.at(-1) === entry` en el rollback nunca es falsa hoy (rama sin cubrir); mantenerla es defensivo y válido.
- Un listener que lanza deja la notificación a medias (ya señalado en COM-002).

### [tester] ronda 1 — 2026-10-17 — PASA
| Criterio | Resultado | Evidencia (comando / salida) |
|---|---|---|
| 14 criterios (T) de agrupación | OK | Un `it` por criterio en `undo-stack-grouping.test.ts`; `pnpm test` → 5 ficheros, 59 tests en verde |
| Tests COM-002 sin modificar | OK (única diferencia: 2 aserciones del getter retirado, aceptado por el revisor) | `git diff HEAD~1 --stat`: `undo-stack.test.ts | 2 -` |
| lint / typecheck | OK | `pnpm lint` y `pnpm typecheck` código 0 |
| Cobertura | OK | `pnpm coverage`: líneas 100 %, `undo-stack.ts` líneas 100 %, ramas 94,44 % |
| Sin any/ts-ignore/console/skip/only/eslint-disable | OK | grep sin resultados |

Casos límite probados y sin fallos: grupo interior que lanza y exterior que atrapa (no anula, según ficha); exterior que lanza tras interior correcto (anula todo, pila usable); `apply` que lanza dentro del grupo (no deja `busy`); redo/clear/setMaxDepth/undo/markSaved dentro de group lanzan y el grupo sigue; rollback conserva redo e `isDirty`; ventana deslizante en 0/500/1000/1501; `mergeKey ''`; clear corta agrupación; maxDepth 2 y 0 con grupos; un solo aviso por group (ninguno si falla); group reentrante desde `apply`.
Observaciones (no bloquean): si `fn` es async, el grupo se cierra al devolver la promesa (no soportado, conviene documentarlo); un reloj que retrocede agrupa (diferencia negativa ≤ delay).
Tests añadidos: `packages/shared/tests/undo/undo-stack-grouping-qa.test.ts` (14).   Rendimiento: no aplica (lógica pura O(1) por paso).
