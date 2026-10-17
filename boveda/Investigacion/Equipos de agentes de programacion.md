---
tipo: investigacion
app: equipo
estado: completa
creado: 2026-10-17
actualizado: 2026-10-17
tags: [investigacion, equipo]
---

# Equipos de agentes de programación

## Preguntas
1. ¿Qué proyectos simulan un equipo de programación con agentes?
2. ¿Qué ideas sirven para nuestro equipo?

## Resumen
Los proyectos maduros coinciden en tres ideas: roles especializados con procedimientos fijos, comunicación por documentos estructurados en vez de conversación libre, y bucles de revisión con límite de rondas. Además, especificaciones muy detalladas permiten que un modelo barato programe bien.

## Hallazgos
| Proyecto | Idea principal | Qué copiamos |
|---|---|---|
| [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Empresa simulada (PM → arquitecto → ingenieros → QA) con procedimientos fijos | Comunicación por documentos (plan, fichas, ADR) |
| [ChatDev](https://github.com/OpenBMB/ChatDev) | Fases encadenadas; diálogos programador↔revisor y programador↔tester con límite de rondas | Bucle con máximo 3 rondas antes de escalar |
| [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD) | "Story files" detallados para que el desarrollador no decida nada | Fichas de tarea autocontenidas |
| Subagentes de Claude Code ([wshobson/agents](https://github.com/wshobson/agents), [awesome-claude-agents](https://github.com/rahulvrane/awesome-claude-agents)) | Un `.md` por agente con rol, herramientas y modelo | Formato de agentes y un modelo por rol |
| Skills de Claude Code (colecciones públicas) | Conocimiento experto empaquetado y cargable | Skills propias por rol; las públicas tienen calidad desigual y no cubren nuestro stack, así que se escriben a medida |

## Riesgos
- En Claude Code un subagente no puede lanzar a otros: la sesión principal coordina (skill `dirigir-equipo`).
- Hay informes de que la precarga `skills:` en subagentes ha fallado en algunas versiones; se verificó en la prueba del 2026-10-17 (ver [[2026-10-17]]).

## Recomendaciones
1. Mantener fichas autocontenidas y criterios verificables.
2. Investigar antes de planificar cada app.

## Fuentes
- Enlaces de la tabla — consultados 2026-10-17
