---
tipo: decision
id: ADR-0002
app: comun
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, documentacion]
---

# ADR-0002 · Toda la documentación en una bóveda de Obsidian

## Contexto
El usuario quiere el proyecto muy documentado en todos sus pasos y listo para Obsidian.

## Decisión
La carpeta `boveda/` del repositorio es una bóveda de Obsidian. Planes, fichas de tarea, decisiones, investigación, manuales y bitácora son notas Markdown con propiedades YAML y wikilinks. Las normas están en la skill `documentar-obsidian`, que tienen precargada todos los agentes.

## Consecuencias
- Un solo sitio para todo: Git guarda la historia y Obsidian da grafo, backlinks y tablero (Bases).
- Los agentes deben mantener el frontmatter correcto para que el tablero funcione.
