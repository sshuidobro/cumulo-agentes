---
name: dirigir-equipo
description: Pone a trabajar al equipo de agentes (investigador, lider, programador, revisor, tester) sobre un objetivo de programación de la suite. Úsala cuando el usuario pida construir una app o funcionalidad "con el equipo", o escriba /dirigir-equipo seguido del objetivo.
---

# Dirigir el equipo de agentes

Tú (la sesión principal) eres el **coordinador**: no escribes código de producción. Lanzas a los subagentes con la herramienta Agent y mueves las fichas por el flujo. Los subagentes no pueden lanzar a otros subagentes, por eso el bucle lo llevas tú. Lee antes la skill `documentar-obsidian`: todo queda en `boveda/`.

Objetivo recibido: $ARGUMENTS

**Lanza SIEMPRE a los subagentes en primer plano** (`run_in_background: false`) y espera su resultado en el mismo turno; para paralelizar, varias llamadas Agent en el mismo mensaje. Nunca termines tu turno "esperando a que acabe" un agente: en modo sin supervisión eso mata al agente y detiene todo el trabajo. Igual con comandos largos (instalaciones, builds): en primer plano con un timeout amplio.

**Regla del usuario: no pares hasta que todas las fichas estén en `hecha`.** No termines el turno para informar de progreso ni para pedir permiso. Las preguntas de producto que surjan se anotan en la bitácora, la ficha afectada queda `bloqueada` y sigues con el resto; las presentas todas juntas al final.

## 0. Bitácora
Abre (o crea desde `boveda/Plantillas/Bitacora.md`) la nota del día `boveda/Bitacora/AAAA-MM-DD.md` y ve anotando cada fase: qué se hizo, decisiones y problemas.

## 1. Investigar
- Si es una app nueva o una funcionalidad importante y `boveda/Investigacion/` no tiene notas que la cubran, lanza `investigador` con el objetivo. Si el objetivo es pequeño y ya está cubierto, salta este paso.
- Varias preguntas independientes → varios `investigador` en paralelo, una pregunta cada uno.

## 2. Planificar
- Lanza `lider` con el objetivo y las rutas de la investigación relevante.
- Si el líder devuelve preguntas para el investigador, lánzalo y vuelve a llamar al líder.
- Si devuelve preguntas que solo el usuario puede responder (de producto: funciones, aspecto, prioridades, licencias, costes), házselas antes de seguir y no lances programadores sobre tareas afectadas. Las decisiones técnicas (librerías, herramientas de desarrollo, valores por defecto razonables) son del líder: no pares por ellas, anótalas en la bitácora y sigue.

## 3. Bucle de tareas
Repite hasta que no quede ninguna ficha de la app en `pendiente`, `cambios-pedidos`, `en-revision` ni `en-test`:
1. **Elegir**: fichas en `pendiente` o `cambios-pedidos` con todas sus `depende_de` en `hecha`.
2. **Programar**: un `programador` por ficha, pasándole solo la ruta de la ficha. Hasta 3 en paralelo si no tocan los mismos ficheros (si se solapan, en serie). Con git, usa `isolation: "worktree"` para los paralelos y fusiona al aprobar.
3. **Revisar**: `revisor` por cada ficha en `en-revision`.
4. **Probar**: `tester` por cada ficha en `en-test`.
5. **Escalar**: ficha con `intentos: 3` o `bloqueada` → `lider` para replanificar (puede pedir `investigador`). Si sigue bloqueada, pregunta al usuario.

Comprueba el estado leyendo el frontmatter (`grep -H '^estado:\|^intentos:' boveda/Apps/*/Tareas/*.md`), no te fíes solo del resumen del subagente.

## 4. Cerrar
- Ejecuta tú mismo build, lint, typecheck y la batería completa de tests una última vez.
- Lanza `lider` para cerrar la iteración (Plan, nota de paridad, Manual).
- Completa la bitácora del día (incluye coste y tiempo si los conoces) y haz commit: `docs: bitácora AAAA-MM-DD`.
- Informa al usuario: qué funciona ya, cómo probarlo (comando exacto) y qué decisiones quedan pendientes.

## Estado en directo (para la Oficina 2D)
Al lanzar y al terminar cada subagente, sobrescribe `registros/estado-equipo.json` (ignorado por git) con:
`{"actualizado":"<ISO>","agentes":{"<id>":{"estado":"trabajando"|"parado","tarea":{"id":"PDF-004","titulo":"..."},"detalle":"..."}}}`
Ids: `lider`, `investigador`, `programador-1`..`programador-3`, `revisor`, `tester`. Es opcional: si falla, sigue trabajando.

## Reglas de coste
- `lider` (Opus) solo al planificar, replanificar y cerrar.
- `programador` (Haiku) hace el grueso del trabajo.
- `investigador`, `revisor` y `tester` (Sonnet): investigación antes de planificar; revisión y test en cada ficha, sin excepción.
