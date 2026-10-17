---
tipo: decision
id: ADR-0003
app: equipo
estado: aceptada
fecha: 2026-10-17
creado: 2026-10-17
actualizado: 2026-10-17
tags: [decision, equipo]
---

# ADR-0003 · Composición del equipo y modelos

## Contexto
El usuario pidió un líder que planifique, programadores baratos, revisores/testers intermedios y un investigador. Ver [[Diseno del equipo]].

## Decisión
| Agente | Modelo | Skills precargadas |
|---|---|---|
| investigador | Sonnet | investigacion-web, documentar-obsidian, formatos-ofimatica, calidad-profesional |
| lider | Opus | calidad-profesional, documentar-obsidian, stack-typescript-react, stack-tauri, formatos-ofimatica |
| programador | Haiku | stack-typescript-react, pruebas-calidad, documentar-obsidian (+ las que diga la ficha) |
| revisor | Sonnet | calidad-profesional, stack-typescript-react, stack-tauri, pruebas-calidad, documentar-obsidian |
| tester | Sonnet | pruebas-calidad, calidad-profesional, formatos-ofimatica, documentar-obsidian |

## Consecuencias
- El modelo caro solo planifica; el barato hace el grueso del código; nada llega a `hecha` sin revisor y tester.
- Si Haiku falla repetidamente en un tipo de tarea, se puede subir el programador a Sonnet para esas fichas (nuevo ADR).
