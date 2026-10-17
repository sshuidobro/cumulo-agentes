---
name: documentar-obsidian
description: Normas para documentar todo el proyecto en la bóveda de Obsidian (carpeta boveda/): dónde va cada nota, frontmatter obligatorio, enlaces, bitácora y decisiones. Úsala SIEMPRE que crees o modifiques cualquier documento, plan, ficha, decisión, investigación o entrada de bitácora.
---

# Documentar en la bóveda de Obsidian

Toda la documentación del proyecto vive en `boveda/`, que se abre directamente como bóveda en Obsidian. El código vive fuera (`apps/`, `packages/`). Si algo no está en la bóveda, no existe.

## Dónde va cada cosa
| Carpeta | Contenido | Quién escribe |
|---|---|---|
| `Inicio.md` | Mapa de la bóveda (índice principal) | líder |
| `Proyecto/` | Visión, diseño del equipo, hoja de ruta general | líder |
| `Decisiones/` | Un ADR por decisión: `ADR-NNNN-titulo.md` | líder (y quien proponga) |
| `Investigacion/` | Notas del investigador: estado del arte, paridad de funciones, librerías, formatos | investigador |
| `Apps/<App>/Plan.md` | Plan de la app: alcance, arquitectura, iteraciones, comando de test | líder |
| `Apps/<App>/Tareas/` | Fichas `<PREFIJO>-NNN-titulo.md` (p. ej. `PDF-004-busqueda.md`) | líder crea; todos añaden al Registro |
| `Apps/<App>/Manual.md` | Manual de usuario de la app (qué hace y cómo) | líder al cerrar iteración |
| `Bitacora/AAAA-MM-DD.md` | Diario: qué se hizo cada día, decisiones, problemas | coordinador (sesión principal) |
| `Plantillas/` | Plantillas de nota (no editar salvo para mejorarlas) | — |

Prefijos de app: `PDF` (lector PDF), `TXT` (procesador de texto), `CAL` (hoja de cálculo), `PRE` (presentaciones), `COM` (paquetes comunes).

## Frontmatter obligatorio
Toda nota empieza con propiedades YAML (Obsidian las muestra como "Propiedades"):
```yaml
---
tipo: tarea | plan | decision | investigacion | bitacora | manual | indice
app: pdf | texto | calculo | presentaciones | comun | equipo
estado: ...            # según el tipo (ver plantilla)
creado: 2026-10-17
actualizado: 2026-10-17
tags: [suite, pdf]
---
```
Fechas en formato `AAAA-MM-DD`. Listas siempre entre corchetes. No inventes propiedades nuevas sin añadirlas a la plantilla.

## Enlaces
- Enlaza con wikilinks: `[[PDF-004-busqueda]]`, `[[ADR-0003-motor-pdf|motor PDF]]`. Así Obsidian construye el grafo y los backlinks.
- Una ficha enlaza a su plan (`[[Apps/Lector PDF/Plan|Plan]]`), a los ADR que la condicionan y a las notas de investigación que usa.
- Un ADR enlaza a la investigación en la que se basa.
- Para código, ruta entre comillas invertidas: `apps/lector-pdf/src/core/search.ts`.

## Estilo
- Español, frases cortas, títulos con `##`. Tablas para comparar, listas de casillas `- [ ]` para pendientes.
- Notas atómicas: una idea por nota; si una nota pasa de ~300 líneas, pártela y enlaza.
- No borres historia: en fichas y ADR se añade, no se reescribe (un ADR sustituido pasa a `estado: sustituida` y enlaza al nuevo).
- Al modificar una nota, actualiza `actualizado:`.
