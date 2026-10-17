---
tipo: investigacion
app: comun
estado: completa
creado: 2026-10-17
actualizado: 2026-10-17
tags: [investigacion, undo, comun]
---

# Deshacer y rehacer en editores

## Preguntas
1. ¿Qué modelo de comando usan prosemirror-history, Lexical y LibreOffice (apply/invert, snapshots, steps)?
2. ¿Cómo agrupan cambios consecutivos, limitan el historial y detectan "guardado/sucio"?
3. ¿Qué copiamos para un `UndoStack` genérico en TypeScript?

## Resumen
- ProseMirror guarda el **inverso de cada step** más un mapa de posiciones; agrupa por tiempo (500 ms) y adyacencia; límite 100 eventos; sin detección de sucio.
- Lexical guarda **snapshots completos de EditorState** (inmutables, con compartición estructural); agrupa por tipo de cambio (insertar/borrar carácter) y retardo de 300 ms; sin límite por defecto; sin "guardado".
- LibreOffice guarda **acciones con Undo/Redo propios** (inverso o estado capturado), con `Merge()` explícito, acciones de lista anidadas (agrupación manual) y límite configurable (20 por defecto en el constructor); las marcas sirven para volver a un punto, no son un "guardado".
- Ninguno de los tres resuelve "sucio" dentro de la pila: se hace fuera. Hay que añadirlo (savepoint).

## Hallazgos

### ProseMirror (prosemirror-history)
- Cada step se guarda ya invertido contra el documento previo (`transform.steps[i].invert(transform.docs[i])`) junto con su mapa; rehacer usa la rama opuesta, que recibe los inversos de los undo. [history.ts](https://raw.githubusercontent.com/ProseMirror/prosemirror-history/master/src/history.ts)
- Valores por defecto: `depth` 100 y `newGroupDelay` 500 ms. Empieza grupo nuevo si el historial está vacío, cambia la composición IME, pasa más de `newGroupDelay` o el cambio no es adyacente al rango anterior. [history.ts](https://raw.githubusercontent.com/ProseMirror/prosemirror-history/master/src/history.ts)
- `closeHistory(tr)` fuerza que el siguiente cambio abra un grupo nuevo. La selección se guarda solo al abrir grupo (selección inicial del evento). [history.ts](https://raw.githubusercontent.com/ProseMirror/prosemirror-history/master/src/history.ts)
- Con edición colaborativa, el evento `rebased` re-mapea e invierte de nuevo los items; hay compresión al superar 500 items vacíos. Relevante solo si hubiera colaboración. [history.ts](https://raw.githubusercontent.com/ProseMirror/prosemirror-history/master/src/history.ts)
- No hay detección de guardado/sucio en el módulo (verificado en la lectura del código).

### Lexical (@lexical/history)
- Modelo de snapshots: cada entrada es `{editor, editorState}`; deshacer/rehacer llama a `setEditorState` con etiqueta `HISTORIC_TAG`. [lexical-history/src/index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts)
- Tres decisiones por actualización: `HISTORY_MERGE` (0, se funde en el actual), `HISTORY_PUSH` (1, apila el anterior y vacía redo) y `DISCARD_HISTORY_CANDIDATE` (2, ignora; composición IME y cambios históricos). [index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts)
- Retardo por defecto 300 ms; solo se funden ediciones del mismo tipo dentro de esa ventana. `getChangeType` clasifica: otro, composición, insertar carácter tras la selección, borrar antes, borrar después; pegar y cortar fuerzan "otro" (siempre paso propio). [index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts)
- `maxDepth` por defecto `null` (ilimitado); al fijarlo se elimina lo más antiguo del undo; el redo no se limita. Los documentos de Lexical dicen que ProseMirror usa 100. [index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts)
- Un cambio que solo mueve la selección (sin nodos sucios) se funde y no crea paso. Un cambio que deja el texto idéntico (compara `exportJSON`) también se funde. [index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts)
- Sin guardado/sucio.

### LibreOffice (SfxUndoManager, EditEngine, Calc)
- `SfxUndoAction` define `Undo()`, `Redo()` y `Merge(next)`; `SfxUndoManager(nMax = 20)`. `AddUndoAction(action, bTryMerge)` intenta `Merge` con la acción previa y, si funde, descarta la nueva. [undo.hxx](https://raw.githubusercontent.com/LibreOffice/core/master/include/svl/undo.hxx), [undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx)
- Añadir una acción vacía el redo; al llegar al límite se elimina la más antigua (`Remove(0)`); límite 0 desactiva el registro. `SetMaxUndoActionCount` recorta al bajar el límite. [undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx)
- Agrupación explícita: `EnterListAction`/`LeaveListAction` crean una `SfxListUndoAction` (compuesta, anidable; las listas vacías se descartan al salir); `LeaveAndMergeListAction` la funde con la anterior. Deshacer/rehacer opera elemento a elemento. [undo.hxx](https://raw.githubusercontent.com/LibreOffice/core/master/include/svl/undo.hxx), [undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx)
- Mientras se ejecuta undo/redo el registro se desactiva (guard), evitando reentradas. [undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx)
- Marcas: `MarkTopUndoAction` asocia un id a la acción superior (o a una marca "vacío"), `HasTopUndoActionMark`/`RemoveMark`/`UndoMark` permiten volver a ese punto. Es un mecanismo de posición, no de "guardado". El módulo no rastrea sucio; solo notifica por listeners (`SfxUndoListener`). [undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx), [undo.hxx](https://raw.githubusercontent.com/LibreOffice/core/master/include/svl/undo.hxx)
- EditEngine (Writer/Impress/celdas): acciones de inverso o con estado capturado. `EditUndoInsertChars::Merge` solo funde si la siguiente es otra inserción en el mismo párrafo y empieza justo donde termina el texto (concatena); `EditUndoRemoveChars` no tiene merge; `EditUndoDelContent` conserva el nodo borrado; `EditUndoSetAttribs` guarda los atributos previos. [editundo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/editeng/source/editeng/editundo.cxx)
- Calc: acciones como `ScUndoPaste` guardan **documentos auxiliares de undo y redo** (copia del rango afectado) más `ScRefUndoData` (rangos con nombre, gráficos, pivotes, etc.). Es decir, snapshots por rango, no por documento. Detalle de población: no verificado en código. [ScUndoPaste](https://docs.libreoffice.org/sc/html/classScUndoPaste.html), [ScRefUndoData](https://docs.libreoffice.org/sc/html/classScRefUndoData.html)
- Cómo marca LibreOffice el documento como modificado (`SetModified`): no verificado.

## Comparativa
| Aspecto | ProseMirror | Lexical | LibreOffice |
|---|---|---|---|
| Modelo | Inverso de step + mapa | Snapshot de estado | Acción con Undo/Redo/Merge (inverso o rango capturado) |
| Agrupar | Tiempo 500 ms + adyacencia + `closeHistory` | Tiempo 300 ms + tipo de cambio | `Merge()` por acción + listas anidadas explícitas |
| Límite | `depth` 100 | `maxDepth` nulo (ilimitado) | 20 por defecto, configurable |
| Sucio/guardado | No | No | Marcas de posición, no sucio |
| Memoria | Baja | Baja si hay compartición estructural | Variable; Calc copia rangos |

## Riesgos
- Snapshots en documentos grandes (hoja de cálculo, PDF anotado): coste de memoria si no hay compartición estructural; usar deltas por rango.
- Fundir tipado por tiempo puro mezcla acciones distintas; IME necesita tratamiento aparte (ambos editores lo descartan o aíslan).
- Estado "guardado" tras recortar el historial: el punto guardado puede salir de la pila; hay que representarlo como "inalcanzable".
- Deshacer una acción no inversa (efecto sobre estado externo, p. ej. ficheros) no está cubierto por ninguno.

## Recomendaciones (Qué copiamos)
1. Comando con `apply()` y `invert()` (devuelve el comando inverso, estilo ProseMirror), con `merge(next): Command | null` opcional (estilo `SfxUndoAction::Merge`). Permitir un comando tipo snapshot de rango para la hoja de cálculo.
2. Pila de `undo` y `redo`; al ejecutar un comando nuevo se vacía `redo`; durante undo/redo se bloquea el registro (guard contra reentrada).
3. Agrupar de tres formas: (a) `merge` entre comandos del mismo tipo y adyacentes, (b) ventana temporal configurable (por defecto 500 ms, `newGroupDelay`), (c) `group(label, fn)` explícito y anidable que produce un comando compuesto (estilo `EnterListAction`); más `closeGroup()` para forzar corte (cambio de selección, pegar, cortar).
4. Excluir de la fusión: pegar, cortar, composición IME, cambios que solo mueven la selección (no crean paso).
5. Límite configurable (`maxDepth`, por defecto 100–200 para texto) que descarta el más antiguo; `0` desactiva; el redo no necesita límite propio.
6. Savepoint: `markSaved()` guarda un id del comando superior (o "vacío"); `isDirty()` = el tope actual difiere del savepoint. Si el recorte elimina el savepoint, marcar `savepointLost` y `isDirty()` siempre true hasta el siguiente guardado. Mismo mecanismo para autoguardado.
7. Eventos/listeners (`onChange`) para habilitar o deshabilitar botones y mostrar la etiqueta ("Deshacer escribir"). Cada comando lleva `label` en español.
8. Tests: undo/redo idempotente (apply+invert = identidad), fusión de tipado, límite, savepoint tras recorte, grupos anidados vacíos descartados.
9. Decisión para el líder: en texto, si se usa ProseMirror/Lexical, reutilizar su historial en el editor y usar el `UndoStack` genérico solo en hoja de cálculo, presentaciones y PDF; sincronizar el savepoint con un contador propio (ninguno lo trae).

## Fuentes
- [prosemirror-history/src/history.ts](https://raw.githubusercontent.com/ProseMirror/prosemirror-history/master/src/history.ts) — consultado 2026-10-17
- [lexical-history/src/index.ts](https://raw.githubusercontent.com/facebook/lexical/main/packages/lexical-history/src/index.ts) — consultado 2026-10-17
- [LibreOffice include/svl/undo.hxx](https://raw.githubusercontent.com/LibreOffice/core/master/include/svl/undo.hxx) — consultado 2026-10-17
- [LibreOffice svl/source/undo/undo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/svl/source/undo/undo.cxx) — consultado 2026-10-17
- [LibreOffice editeng/source/editeng/editundo.cxx](https://raw.githubusercontent.com/LibreOffice/core/master/editeng/source/editeng/editundo.cxx) — consultado 2026-10-17
- [ScUndoPaste (docs LibreOffice)](https://docs.libreoffice.org/sc/html/classScUndoPaste.html) — consultado 2026-10-17
- [ScRefUndoData (docs LibreOffice)](https://docs.libreoffice.org/sc/html/classScRefUndoData.html) — consultado 2026-10-17
