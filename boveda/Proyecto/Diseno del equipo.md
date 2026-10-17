---
tipo: plan
app: equipo
estado: en-curso
creado: 2026-10-17
actualizado: 2026-10-17
tags: [equipo, diseno]
---

# Diseño del equipo de agentes

Inspiración y fuentes: [[Equipos de agentes de programacion]]. Modelos y skills: [[ADR-0003-composicion-del-equipo]].

## El equipo
| Agente | Modelo | Hace | No hace |
|---|---|---|---|
| `investigador` | Sonnet | Busca en la web: funciones de la competencia, librerías, formatos, problemas conocidos. Deja notas citadas en `Investigacion/` | Código |
| `lider` | Opus | Plan de cada app, ADR, fichas de tarea, replanificación, cierre de iteración y manual | Código de producción |
| `programador` | Haiku | Implementa UNA ficha con sus tests | Decidir diseño, salirse de la ficha |
| `revisor` | Sonnet | Revisa el cambio contra la ficha, el stack y la calidad profesional | Modificar código |
| `tester` | Sonnet | Prueba cada criterio con evidencia, E2E, documentos reales, rendimiento | Modificar código de producción |

La sesión principal de Claude Code hace de **coordinador** con la skill `dirigir-equipo` (los subagentes no pueden lanzar a otros) y escribe la bitácora.

## Skills de experto (`.claude/skills/`)
| Skill | Para qué |
|---|---|
| `stack-typescript-react` | Estructura del monorepo, TypeScript estricto, React, estado, rendimiento, accesibilidad |
| `stack-tauri` | Tauri 2: capa de plataforma web/escritorio, permisos, seguridad, Rust, empaquetado |
| `pruebas-calidad` | Vitest, Testing Library, Playwright, documentos de prueba, ida y vuelta, rendimiento |
| `formatos-ofimatica` | PDF, DOCX/ODT, XLSX/ODS/CSV, PPTX/ODP y sus librerías |
| `calidad-profesional` | Definición de "terminado" a nivel Office/Adobe |
| `documentar-obsidian` | Normas de esta bóveda |
| `investigacion-web` | Método de investigación y evaluación de librerías |
| `dirigir-equipo` | El bucle de coordinación (`/dirigir-equipo <objetivo>`) |

## Flujo de una app
```
investigador ──► notas de paridad y librerías
      │
      ▼
lider ──► Plan.md + ADR + fichas
      │
      ▼  por cada ficha lista (hasta 3 en paralelo)
programador ──► revisor ──► tester ──► hecha
      ▲            │           │
      └── cambios-pedidos ◄────┘   (a los 3 rechazos ► lider replanifica)
      │
      ▼  al acabar las fichas
lider cierra iteración: Plan, paridad, Manual · coordinador: bitácora
```

## Estados de una ficha
`pendiente → en-curso → en-revision → en-test → hecha`. Rechazo → `cambios-pedidos`. Otros: `bloqueada`, `sustituida`.

## Dónde está cada cosa
- Agentes: `.claude/agents/` · Skills: `.claude/skills/`
- Documentación: esta bóveda (`boveda/`), normas en la skill `documentar-obsidian`
- Código: `apps/` y `packages/` (se crean con la primera app)
- Primera prueba del equipo (contador de palabras, formato anterior a la bóveda): `ejemplos/prueba-contar-palabras/`
