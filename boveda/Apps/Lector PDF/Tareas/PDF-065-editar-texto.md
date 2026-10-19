---
tipo: tarea
id: PDF-065
titulo: Editar texto existente - decidir alcance
app: pdf
estado: bloqueada
depende_de: [PDF-052, PDF-135]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-6, edicion, investigacion, decision-usuario]
---

# PDF-065 · Editar texto existente: decidir alcance

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]] (§ edición: «Editar texto existente (reflujo, fuentes)», opcional, Pro) · Relacionadas: [[ADR-0036-anadir-contenido-aplanando]], [[ADR-0039-redaccion-real]]

> **Bloqueada por una decisión de producto del usuario** (pregunta anotada en [[Bitacora/2026-10-19|la bitácora del 2026-10-19]]). No empezar hasta que el líder la detalle con la respuesta.

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
