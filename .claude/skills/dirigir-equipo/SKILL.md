---
name: dirigir-equipo
description: Pone a trabajar al equipo de agentes (lider, programador, revisor, tester) sobre un objetivo de programación. Úsala cuando el usuario pida construir una app o funcionalidad "con el equipo", o escriba /dirigir-equipo seguido del objetivo.
---

# Dirigir el equipo de agentes

Tú (la sesión principal) eres el **coordinador**: no escribes código. Lanzas a los subagentes con la herramienta Agent y mueves las fichas de `tareas/` por el flujo. Los subagentes no pueden lanzar a otros subagentes, por eso el bucle lo llevas tú.

Objetivo recibido: $ARGUMENTS

## 1. Planificar
- Lanza `lider` con el objetivo y el contenido actual de `PLAN.md` (si existe).
- Revisa su resumen. Si devuelve preguntas que solo el usuario puede responder, házselas antes de seguir y no lances programadores sobre tareas afectadas.

## 2. Bucle de tareas
Repite hasta que no quede ninguna ficha en `pendiente`, `cambios-pedidos`, `en-revision` ni `en-test`:

1. **Elegir**: fichas en `pendiente` o `cambios-pedidos` cuyas `depende_de` estén todas en `hecha`.
2. **Programar**: lanza un `programador` por ficha, pasándole solo la ruta de la ficha. Hasta 3 en paralelo si no tocan los mismos ficheros (si se solapan, en serie). Si el proyecto usa git, usa `isolation: "worktree"` para los paralelos y fusiona al aprobar.
3. **Revisar**: por cada ficha en `en-revision`, lanza `revisor`.
4. **Probar**: por cada ficha en `en-test`, lanza `tester`.
5. **Escalar**: si una ficha llega a `intentos: 3`, o queda `bloqueada`, lanza `lider` para replanificarla. Si el líder también la deja `bloqueada`, pregunta al usuario.

Comprueba el estado leyendo el frontmatter de las fichas (`grep -H '^estado:' tareas/*.md`), no te fíes solo del resumen del subagente.

## 3. Cerrar
- Ejecuta tú mismo el build y la batería completa de tests una última vez.
- Lanza `lider` para que actualice `PLAN.md` (estado de cada tarea y siguiente iteración).
- Informa al usuario: qué funciona ya, cómo probarlo (comando exacto) y qué decisiones quedan pendientes.

## Reglas de coste
- `lider` (modelo caro) solo al planificar, replanificar y cerrar.
- `programador` (modelo barato) hace el grueso del trabajo.
- `revisor` y `tester` (modelo intermedio) en cada ficha, sin excepción: nada se da por hecho sin su visto bueno.
