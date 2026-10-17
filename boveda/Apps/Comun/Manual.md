---
tipo: manual
app: comun
estado: vigente
creado: 2026-10-17
actualizado: 2026-10-17
tags: [manual, comun, undo]
---

# Manual · Comun (paquetes comunes)

Plan: [[Apps/Comun/Plan|Plan]] · Decisiones: [[ADR-0005-modelo-deshacer-rehacer]] · [[ADR-0006-eslint]]

Paquetes para los programadores de las apps; el usuario final no los ve directamente. Tras la iteración 1 hay un monorepo con lint, typecheck, tests y cobertura, y `UndoStack` en `@suite/shared`.

## Qué se puede hacer ya
- Dar deshacer/rehacer a cualquier documento inmutable: ejecutar, deshacer, rehacer.
- Agrupar cambios: tecleo seguido (misma `mergeKey`, ≤ 500 ms) y acciones compuestas con `group()`.
- Saber si el documento tiene cambios sin guardar (`isDirty`), también tras deshacer hasta el punto guardado.
- Limitar el historial (100 entradas por defecto).
- Pintar la UI (botones, menú "Deshacer escribir") con `getState()` y `subscribe()`.

Aún no hay atajos Ctrl+Z / Ctrl+Y, botones ni puente con React/zustand (ver "Siguiente iteración" en el Plan).

## Usar UndoStack desde una app
Importa siempre desde el paquete, nunca rutas internas:
```ts
import { UndoStack, type Command } from '@suite/shared';
```
Una pila por documento abierto. El documento `D` debe ser **inmutable**: los comandos devuelven un documento nuevo, nunca mutan el que reciben.

### 1. Definir comandos
Un comando tiene `label` (en español, para "Deshacer <label>"), `apply(doc)` y `invert(before)`, que recibe el documento **antes** de aplicar y devuelve el comando contrario. `mergeKey` es opcional.
```ts
type Doc = string;

function insertText(pos: number, text: string, mergeKey?: string): Command<Doc> {
  return {
    label: 'escribir',
    ...(mergeKey === undefined ? {} : { mergeKey }), // exactOptionalPropertyTypes
    apply: (doc) => doc.slice(0, pos) + text + doc.slice(pos),
    invert: () => deleteText(pos, text.length),
  };
}

function deleteText(pos: number, length: number): Command<Doc> {
  return {
    label: 'borrar',
    apply: (doc) => doc.slice(0, pos) + doc.slice(pos + length),
    invert: (before) => insertText(pos, before.slice(pos, pos + length)),
  };
}
```
Reglas: `apply` e `invert` puros y deterministas; si un cambio no es válido, devuelve el mismo `doc` o lanza (la pila queda intacta, ver "Errores").

### 2. Crear la pila y ejecutar
```ts
const stack = new UndoStack<Doc>('', { maxDepth: 100, groupDelayMs: 500 });

stack.execute(insertText(0, 'h', 'typing'));
stack.execute(insertText(1, 'ola', 'typing')); // se agrupa con el anterior
stack.doc;   // 'hola'
stack.undo(); // true → '' (una sola entrada)
stack.redo(); // true → 'hola'
```
`undo()`/`redo()` devuelven `false` si no hay nada que hacer. `execute` devuelve el documento nuevo.

Opciones del constructor (todas opcionales):
| Opción | Por defecto | Uso |
|---|---|---|
| `maxDepth` | 100 | Entradas de deshacer que se guardan. `0` = sin historial. Entero ≥ 0 o `RangeError`. |
| `groupDelayMs` | 500 | Ventana para agrupar cambios con la misma `mergeKey` (inclusiva). Número finito ≥ 0 o `RangeError`. |
| `now` | `Date.now` | Reloj; en tests, pasa uno falso (`let t = 0; const now = () => t;`). |

### 3. Agrupación automática y `closeGroup()`
Un `execute` se añade a la entrada anterior si: tienen la misma `mergeKey`, han pasado ≤ `groupDelayMs` y no se ha cortado la agrupación. La cortan `undo`, `redo`, `markSaved`, `clear`, el final de un `group()` y `closeGroup()`.
- Sin `mergeKey` = entrada propia siempre (pegar, cortar, IME).
- Llama a `stack.closeGroup()` cuando el usuario mueve el cursor o cambia la selección, pierde el foco o cambia de herramienta. No notifica.

### 4. Acciones compuestas con `group()`
Todo lo que se ejecute dentro de `fn` forma **una** entrada con la etiqueta del grupo. Notifica una sola vez, al final.
```ts
stack.group('reemplazar', () => {
  stack.execute(deleteText(0, 4));
  stack.execute(insertText(0, 'adiós'));
});
stack.getState().undoLabel; // 'reemplazar'
```
- Devuelve lo que devuelva `fn`: `stack.group('g', () => 42) === 42`.
- Anidable: los grupos interiores ignoran su etiqueta; todo cae en el exterior.
- Si `fn` lanza y el error sale del grupo exterior, se **anula todo** (documento y rehacer vuelven a como estaban) y el error se relanza. Un error que `fn` atrapa no anula nada.
- Grupo sin cambios: no crea entrada ni notifica.
- Dentro de `group()` no se puede llamar a `undo`, `redo`, `markSaved`, `clear` ni `setMaxDepth`: lanzan `Error('UndoStack: operación no permitida dentro de group()')`.
- **`fn` debe ser síncrona.** Con `async`/promesas el grupo se cierra al devolver la promesa: lo que pase tras el `await` queda fuera y un rechazo no anula nada. Haz el trabajo asíncrono (leer un fichero, decodificar una imagen) **antes** y luego llama a `group()` con el resultado.

### 5. Guardado y cambios sin guardar
```ts
await platform.saveFile(/* ... */); // cuando exista packages/platform
stack.markSaved();
stack.isDirty(); // false
```
- `isDirty()` es `true` si el documento actual no es el guardado; deshacer hasta el punto guardado lo vuelve `false`.
- Si se ejecuta algo tras deshacer más allá del guardado, o el límite recorta la entrada guardada, el estado guardado ya no es alcanzable y `isDirty()` queda `true`.
- Llama a `markSaved()` solo cuando el guardado ha terminado bien. Úsalo para el título "sin guardar" y el aviso al cerrar.

### 6. Límite de historial y `clear()`
- `stack.setMaxDepth(n)` cambia el límite y recorta en el momento (p. ej. desde Preferencias).
- `stack.clear()` vacía deshacer y rehacer (p. ej. tras recargar el fichero) **sin** cambiar el estado sucio.

### 7. Pintar la UI
```ts
const unsubscribe = stack.subscribe((s) => {
  // s: { canUndo, canRedo, undoLabel, redoLabel, undoDepth, redoDepth, isDirty }
  undoButton.disabled = !s.canUndo;
  undoButton.title = s.undoLabel === null ? 'Deshacer' : `Deshacer ${s.undoLabel}`;
});
// al cerrar el documento:
unsubscribe();
```
Notifica tras `execute` (fuera de grupo), `undo`/`redo` con éxito, `markSaved`, `clear`, `setMaxDepth` y el cierre de un `group()` con cambios. `getState()` da el mismo objeto a demanda.
- **Los listeners no deben lanzar**: si uno lanza, los siguientes no se enteran y el error sale de la llamada aunque el cambio ya se aplicó (mejora pendiente en el Plan).
- No llames a la pila desde un listener ni desde `apply`/`invert`: provoca `Error('UndoStack: reentrada no permitida')`.

### 8. Errores
- Si `apply` o `invert` lanzan en `execute`, el error se propaga y el documento, el historial y el estado sucio **no cambian**.
- Si falla un `undo`/`redo`, la entrada se conserva y se puede reintentar.

## Comprobaciones
Desde la raíz del repositorio:
```
pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm coverage
```
| Comando | Debe dar |
|---|---|
| `pnpm install` | Sin errores ni avisos `unmet peer` (necesita `.pnpmfile.cjs`, [[ADR-0006-eslint]]). |
| `pnpm lint` | Código 0, sin avisos (`--max-warnings 0`). |
| `pnpm typecheck` | Código 0. |
| `pnpm test` | Todo en verde (59 tests al cerrar la iteración 1). |
| `pnpm coverage` | Código 0; umbral 80 % de líneas (hoy 100 %). |

Tests de referencia para ver ejemplos de uso: `packages/shared/tests/undo/undo-stack.test.ts` (núcleo), `undo-stack-grouping.test.ts` (agrupación), `undo-stack.edge.test.ts` y `undo-stack-grouping-qa.test.ts` (casos límite). Ayudas de comandos de texto: `packages/shared/tests/undo/text-commands.ts`.
