---
tipo: decision
id: ADR-0005
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, undo, comun]
---

# ADR-0005 · Modelo de deshacer/rehacer común (UndoStack)

## Contexto
Todas las apps necesitan deshacer/rehacer, agrupar cambios consecutivos, límite de historial y saber si hay cambios sin guardar. Investigación: [[Deshacer y rehacer en editores]].

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Licencia |
|---|---|---|---|
| A. Comandos `apply`/`invert` (estilo ProseMirror/LibreOffice) en una pila genérica propia | Memoria baja; sirve para hoja, presentaciones y PDF; deltas por rango | Cada comando debe saber invertirse (y testearse) | propia |
| B. Snapshots completos del documento (estilo Lexical) | Trivial de implementar | Memoria alta en hojas de cálculo grandes sin compartición estructural | propia |
| C. Usar `prosemirror-history` o `@lexical/history` para todo | Probados | Atados a su editor; no sirven para hoja/PDF; sin "guardado" | MIT |

## Decisión
**Opción A**, en `packages/shared/src/undo/`:
- `Command<D>` con `label` (español), `apply(doc) → doc`, `invert(before) → Command<D>` y `mergeKey?` opcional. Un snapshot de rango es simplemente un comando cuyo `invert` devuelve "restaurar rango".
- La pila guarda **entradas** = lista de pasos `{forward, inverse}`. Agrupar = añadir pasos a la entrada superior (no se fusionan comandos). `Command.merge` (compresión) queda **fuera** hasta que un perfil de memoria lo pida.
- Agrupación: mismo `mergeKey` + ventana `groupDelayMs` (500 ms, como ProseMirror) + `group(label, fn)` explícito anidable + `closeGroup()`. Pegar, cortar e IME no llevan `mergeKey`.
- Límite `maxDepth` (100 por defecto; 0 = sin historial). Redo sin límite.
- Guardado: cada entrada recibe un id creciente que nunca se reutiliza; `markSaved()` guarda el id del tope; `isDirty()` = id del tope ≠ id guardado. Al recortar, el id de la última entrada eliminada pasa a ser el id "base", así el punto guardado recortado se vuelve inalcanzable sin banderas extra.

**Procesador de texto:** el editor (ProseMirror/Tiptap o Lexical) se decidirá en su propio ADR. Si trae historial propio, se usará ese historial para el contenido del texto y un adaptador replicará la API de estado (`canUndo`, `isDirty`, etiquetas) para la barra de herramientas; el `UndoStack` se usará en el resto de apps y en lo que el editor no cubra. Se construye el `UndoStack` igualmente porque lo necesitan hoja, presentaciones y PDF.

## Consecuencias
- Cada comando de cada app necesita un test `apply` + `invert` = identidad.
- Efectos externos (escribir ficheros) no son comandos deshacibles.
- Vigilar memoria en entradas muy largas (teclear 10 000 letras = 10 000 pasos en una entrada); si molesta, añadir `merge` en un ADR nuevo.
