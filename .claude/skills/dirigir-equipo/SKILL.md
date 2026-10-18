---
name: dirigir-equipo
description: Pone a trabajar al equipo de agentes (investigador, lider, programador, revisor, tester) sobre un objetivo de programación de la suite. Úsala cuando el usuario pida construir una app o funcionalidad "con el equipo", o escriba /dirigir-equipo seguido del objetivo.
---

# Dirigir el equipo de agentes

Tú (la sesión principal) eres el **coordinador**: no escribes código de producción. Lanzas a los subagentes con la herramienta Agent y mueves las fichas por el flujo. Los subagentes no pueden lanzar a otros subagentes, por eso el bucle lo llevas tú. Lee antes la skill `documentar-obsidian`: todo queda en `boveda/`.

Objetivo recibido: $ARGUMENTS

**Lanza SIEMPRE a los subagentes en primer plano** (`run_in_background: false`) y espera su resultado en el mismo turno; para paralelizar, varias llamadas Agent en el mismo mensaje. Nunca termines tu turno "esperando a que acabe" un agente: en modo sin supervisión eso mata al agente y detiene todo el trabajo. Igual con comandos largos (instalaciones, builds): en primer plano con un timeout amplio.

**Regla del usuario: no pares hasta que todas las fichas estén en `hecha`.** No termines el turno para informar de progreso ni para pedir permiso. Las preguntas de producto que surjan se anotan en la bitácora, la ficha afectada queda `bloqueada` y sigues con el resto; las presentas todas juntas al final. En modo ronda el bucle lo sostiene `scripts/equipo.sh`: terminar una ronda no es parar.

## Modo ronda (`--ronda` en el objetivo)
Si el objetivo trae `--ronda`, lo lanza `scripts/equipo.sh`, que te vuelve a llamar con el contexto limpio tras cada ronda. En una ronda:
1. Termina primero las fichas que ya estén en `en-revision` o `en-test` (revisor y tester).
2. Elige hasta 3 fichas accionables (paso 3.1) y llévalas por programar → revisar → probar hasta `hecha` o `cambios-pedidos`. Una ficha devuelta se reintenta en la ronda siguiente, no en esta.
3. Si toca escalar o cerrar una iteración, hazlo en esta ronda.
4. Anota la ronda en la bitácora, haz commit y **termina el turno** con una línea: `RONDA: <fichas hechas> hechas, <fichas devueltas> devueltas, quedan <N> accionables`.
Así ninguna conversación crece durante horas: cada ronda empieza de cero y no se vuelve a pagar en cada mensaje todo lo leído en las anteriores. El estado vive en las fichas, no en tu memoria.

## Contexto del coordinador (ahorro de tokens)
Tu conversación se reenvía entera en cada mensaje, así que lo que leas lo pagas muchas veces:
- Estado: solo con `grep -H '^estado:\|^intentos:\|^depende_de:' boveda/Apps/*/Tareas/*.md`. No abras fichas enteras: al subagente le pasas la ruta y él la lee.
- No leas el `Plan.md` ni la bitácora enteros. Para añadir a la bitácora, usa `Edit` sobre la sección o añade al final con `cat >> fichero <<'EOF'`.
- Encargos a los subagentes: ruta de la ficha + una línea. Pídeles la respuesta corta que define su agente; no reenvíes sus informes completos a otros agentes (ya están en el Registro de la ficha).
- Salida de comandos con `| tail -40`; si algo falla, repite solo lo que falla con la salida completa.

## 0. Bitácora
Abre (o crea desde `boveda/Plantillas/Bitacora.md`) la nota del día `boveda/Bitacora/AAAA-MM-DD.md` y ve anotando cada fase: qué se hizo, decisiones y problemas.

## 1. Investigar
- Si es una app nueva o una funcionalidad importante y `boveda/Investigacion/` no tiene notas que la cubran, lanza `investigador` con el objetivo. Si el objetivo es pequeño y ya está cubierto, salta este paso.
- Varias preguntas independientes → varios `investigador` en paralelo, una pregunta cada uno.

## 2. Planificar
- Antes, lanza `explorador` (modelo barato) con las preguntas de código del objetivo («qué módulos tocan X», «dónde se hace Y») y pídele que guarde su informe en `registros/contexto/<objetivo-o-id>.md`.
- Lanza `lider` con el objetivo, las rutas de la investigación relevante y la del informe del explorador.
- Si el líder devuelve preguntas para el investigador, lánzalo y vuelve a llamar al líder.
- Si devuelve preguntas que solo el usuario puede responder (de producto: funciones, aspecto, prioridades, licencias, costes), házselas antes de seguir y no lances programadores sobre tareas afectadas. Las decisiones técnicas (librerías, herramientas de desarrollo, valores por defecto razonables) son del líder: no pares por ellas, anótalas en la bitácora y sigue.

## 3. Bucle de tareas
Repite hasta que no quede ninguna ficha de la app en `pendiente`, `cambios-pedidos`, `en-revision` ni `en-test`:
1. **Elegir**: fichas en `pendiente` o `cambios-pedidos` con todas sus `depende_de` en `hecha`.
2. **Programar**: un `programador` por ficha, pasándole solo la ruta de la ficha. Hasta 3 en paralelo si no tocan los mismos ficheros (si se solapan, en serie). Con git, usa `isolation: "worktree"` para los paralelos y fusiona al aprobar.
3. **Revisar**: `revisor` por cada ficha en `en-revision`.
4. **Probar**: `tester` por cada ficha en `en-test`.
5. **Escalar**: ficha con `intentos: 3` o `bloqueada` → `explorador` con la duda de la ficha (informe en `registros/contexto/<ID>.md`) y después `lider` para replanificar con ese informe (puede pedir `investigador`). Si sigue bloqueada, pregunta al usuario.

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
- Coordinador (tú): Sonnet desde `scripts/equipo.sh`. Tu trabajo es repartir y comprobar estados; la calidad la ponen revisor y tester.
- `explorador` (Haiku): localiza el código antes de que trabaje un agente caro.
- `lider` (Opus) solo al planificar, replanificar y cerrar.
- `programador` (Haiku) hace el grueso del trabajo.
- `investigador`, `revisor` y `tester` (Sonnet): investigación antes de planificar; revisión y test en cada ficha, sin excepción.
