---
tipo: tarea
id: PDF-065
titulo: Editar texto existente - decidir alcance
app: pdf
estado: sustituida
depende_de: [PDF-052, PDF-135]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-20
tags: [tarea, pdf, iteracion-6, edicion, investigacion, decision-usuario]
---

# PDF-065 · Editar texto existente: decidir alcance

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]] (§ edición: «Editar texto existente (reflujo, fuentes)», opcional, Pro) · Relacionadas: [[ADR-0036-anadir-contenido-aplanando]], [[ADR-0039-redaccion-real]]

> **Sustituida** (2026-10-20). El usuario eligió la opción A; alcance en [[ADR-0042-editar-texto-linea-simple]]. Fichas nuevas: [[PDF-143-editar-texto-estilo-y-borrado]] → [[PDF-144-editar-texto-localizar-linea]] → [[PDF-145-editar-texto-aplicar]] → [[PDF-146-editar-texto-estado]] → [[PDF-147-editar-texto-interfaz]].

## Objetivo
Permitir corregir texto que ya está en el PDF. Antes hay que decidir qué tipo de edición se quiere, porque cambia el aspecto del resultado.

## Lo que sabe el líder (para la decisión)
- Las fuentes incrustadas en los PDF suelen ser **subconjuntos**: solo traen los glifos usados. Escribir una letra que no estaba (p. ej. una «ñ» nueva) con la fuente original es imposible sin otra fuente.
- Con las piezas de redactar ([[PDF-062-redactar]], [[PDF-135-redactar-aplicar]]) ya sabremos **quitar** una línea exacta sin mover el resto, y con las de añadir texto ([[PDF-059-anadir-texto-imagen]]) **escribir** texto nuevo en su lugar.
- Opciones:

| Opción | Qué ve el usuario | Coste |
|---|---|---|
| **A. Sustituir línea con fuente estándar** (recomendada) | Doble clic en una línea → se edita en un cuadro → al guardar, la línea original se borra de verdad y se escribe la nueva con Helvetica, Times o Courier (la más parecida), mismo tamaño y color. Sin reflujo: si el texto es más largo, se sale de la línea | Medio (reutiliza redactar + añadir texto): 3-4 fichas |
| B. Edición con la fuente original cuando tenga los glifos | Igual que A, pero si todos los caracteres existen en el subconjunto se usa la fuente original (aspecto idéntico); si no, se avisa y se usa la estándar | Alto: leer subconjuntos y sus codificaciones (TrueType/CFF/Type1, `/ToUnicode` inverso) |
| C. Edición por párrafos con reflujo (como Acrobat Pro) | Se edita un párrafo entero y el texto se recoloca en sus líneas | Muy alto: detectar párrafos, medir, partir líneas, fuentes; meses |
| D. No ofrecerlo | — | Ninguno; «Añadir texto» y «Redactar» cubren tapar y escribir encima |

## Pregunta para el usuario
¿Qué alcance quieres para «Editar texto existente»: **A** (sustituir línea con fuente estándar parecida, sin reflujo; recomendada), **B** (como A pero con la fuente original cuando se pueda), **C** (párrafos con reflujo, muy costoso) o **D** (no ofrecerlo por ahora)?

## Qué hay que hacer
Por detallar cuando el usuario responda (ADR nuevo y fichas).

## Criterios de aceptación
- [ ] Respuesta del usuario anotada aquí y en la bitácora; ADR de alcance; fichas nuevas detalladas y esta ficha `sustituida` (o `hecha` si la respuesta es D).

## Fuera de alcance
- Editar imágenes u objetos existentes (no planificado).

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [líder] detalle — 2026-10-19
- Bloqueada a la espera de una decisión de producto (aspecto del texto editado). Depende ahora también de [[PDF-135-redactar-aplicar]], que aporta la mitad de la técnica de la opción recomendada.

### [coordinador] decisión del usuario — 2026-10-19
- Sergio eligió la **opción A · Línea simple** (19:06 UTC): doble clic en una línea y reescribirla con una fuente estándar parecida (Helvetica/Times/Courier), sin recolocar el texto si se alarga.
- Siguiente paso, para el **líder**: escribir el ADR de alcance y desglosar las fichas nuevas reutilizando «Redactar» ([[PDF-135-redactar-aplicar]]) y «Añadir texto»; después marcar esta ficha como `sustituida` enlazando las nuevas. No es una ficha para el programador tal cual.

### [programador] ronda 1 — 2026-10-20
- Ficheros cambiados: esta ficha (estado y Registro). Sin cambios de código.
- Qué he hecho: he leído la ficha. No es implementable tal cual: su propio texto dice que el alcance se detalla tras la respuesta del usuario, que falta el ADR de alcance y que las fichas de implementación se crean después («Por detallar»). La decisión del usuario (opción A, anotada el 2026-10-19) está registrada, pero no hay especificación de API, ficheros ni criterios técnicos que implementar.
- Comandos ejecutados y resultado: no aplica (sin cambios de código; no ejecuto lint, typecheck ni tests).
- Dudas o cosas que no he podido hacer: el líder debe escribir el ADR de alcance y desglosar las fichas nuevas (reutilizando PDF-135 y PDF-059) y marcar esta ficha como `sustituida`. Antes de implementar la parte A deben estar `hecha` PDF-052 y PDF-135.

### [líder] replanificación — 2026-10-20
- Respuesta del usuario: **opción A** (línea simple con fuente estándar, sin reflujo). ADR de alcance: [[ADR-0042-editar-texto-linea-simple]].
- Desglose: [[PDF-143-editar-texto-estilo-y-borrado]] (intérprete con estilo por operación y `removeGlyphs` común; accionable ya), [[PDF-144-editar-texto-localizar-linea]] (← 143), [[PDF-145-editar-texto-aplicar]] (← 144), [[PDF-146-editar-texto-estado]] (← 145, 137), [[PDF-147-editar-texto-interfaz]] (← 146, 139; cadena en serie de interfaz).
- Esta ficha pasa a `sustituida`.
