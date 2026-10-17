---
tipo: manual
app: equipo
estado: hecha
creado: 2026-10-17
actualizado: 2026-10-17
tags: [equipo, herramienta, oficina-2d]
---

# Oficina 2D del equipo

Diseño del equipo: [[Diseno del equipo]] · Fichas: [[Tareas.base]]

## Qué es
Un "videojuego" en pixel art que muestra al equipo de agentes trabajando. Hay un personaje por rol: líder, investigador, tres programadores, revisor y tester.
- **Trabajando**: el personaje se mueve por la oficina siguiendo su rutina y lleva un bocadillo con la ficha (p. ej. `PDF-004`). Su monitor está encendido.
- **Parado**: se queda quieto en su mesa con dos zetas, y su monitor está apagado.

| Rol | Rutina mientras trabaja |
|---|---|
| Líder | Mesa → pizarra del plan → mira por encima del hombro a un programador ocupado |
| Investigador | Mesa → estantería, lee un libro |
| Programador | Teclea en su mesa → va a por café |
| Revisor | Mesa → se pone delante de la mesa de un programador ocupado |
| Tester | Mesa → armario de pruebas (QA), con luces que parpadean |

El código está en `herramientas/oficina-2d/` (JavaScript sin dependencias, fuera de las apps).

## Cómo abrirla
- **En directo** (lee la bóveda cada 3 s): `node herramientas/oficina-2d/estado.mjs --servir` y abrir `http://localhost:4173`. Solo escucha en `127.0.0.1`: nada sale del ordenador.
- **Fichero suelto** con una instantánea del estado actual: `node herramientas/oficina-2d/empaquetar.mjs` genera `herramientas/oficina-2d/oficina-autonoma.html` (no se sube al repo).
- **Solo el estado en JSON**: `node herramientas/oficina-2d/estado.mjs`.
- El botón **Ejemplo** muestra un equipo imaginario recorriendo el flujo completo de fichas del lector PDF.
- Tests: `node --test 'herramientas/oficina-2d/pruebas/*.test.mjs'`.

## De dónde sale el estado
Se deduce del frontmatter de la bóveda (`derivar.mjs`):
- **Programadores**: una ficha `en-curso` cada uno, por orden de id. Si hay más de 3, el tercero indica cuántas más.
- **Revisor**: alguna ficha `en-revision`. **Tester**: alguna ficha `en-test`.
- **Líder**: hay una ficha `bloqueada` o con `intentos: 3` sin cerrar, o un `Plan.md` en `borrador`.
- **Investigador**: hay una nota de `Investigacion/` con `estado: en-curso`.

### Estado en vivo (opcional)
Las fichas solo cambian cuando un agente termina una fase, así que no saben qué subagente está lanzado en cada momento. Si el coordinador escribe `registros/estado-equipo.json` (carpeta ignorada por git), ese fichero manda sobre lo deducido durante 10 minutos:
```json
{
  "actualizado": "2026-10-17T16:00:00Z",
  "agentes": {
    "investigador": { "estado": "trabajando", "tarea": "Formatos PDF", "detalle": "Investigando" },
    "programador-1": { "estado": "trabajando", "tarea": { "id": "PDF-004", "titulo": "Buscar texto" } },
    "revisor": { "estado": "parado" }
  }
}
```
Ids válidos: `lider`, `investigador`, `programador-1`, `programador-2`, `programador-3`, `revisor`, `tester`. Que la skill `dirigir-equipo` escriba este fichero al lanzar y al terminar cada subagente es una propuesta pendiente; hasta entonces basta con las fichas.
