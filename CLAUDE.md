# Equipo de agentes: suite ofimática personal

Proyecto de uso personal (no comercial): un paquete de aplicaciones tipo procesador de texto, lector de PDF, presentaciones y hoja de cálculo.

## Tecnología (decidida por el usuario)
- TypeScript + React, empaquetado como app de escritorio con Tauri (también funciona en el navegador).
- El líder elige las librerías concretas de cada app (p. ej. PDF.js para PDF) y las documenta en `PLAN.md`.

## Cómo se trabaja aquí
- El trabajo de programación lo hace el equipo de agentes de `.claude/agents/`: `lider` planifica, `programador` implementa, `revisor` revisa el código y `tester` lo prueba.
- Para arrancar un objetivo: `/dirigir-equipo <objetivo>` (skill en `.claude/skills/dirigir-equipo/`).
- El plan vive en `PLAN.md`; cada tarea es una ficha en `tareas/` con el formato de `plantillas/tarea.md`.
- Flujo de estados de una ficha: pendiente → en-curso → en-revision → en-test → hecha. Cualquier rechazo la devuelve a `cambios-pedidos`; a los 3 rechazos se escala al líder.

## Normas para todos los agentes
- Documentación, fichas y mensajes en español; código e identificadores en inglés.
- Nunca desactivar ni saltar tests para que pasen.
- No añadir dependencias que no estén decididas en `PLAN.md`.
