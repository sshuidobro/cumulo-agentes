---
tipo: tarea
id: PDF-053
titulo: Organizar páginas: girar, borrar y reordenar
app: pdf
estado: bloqueada
depende_de: [PDF-052]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-19
tags: [tarea, pdf, iteracion-5, organizar, ui, por-detallar]
---

# PDF-053 · Organizar páginas: girar, borrar y reordenar

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Vista de cuadrícula de miniaturas para girar, borrar y reordenar páginas (arrastrar y teclado), con deshacer y guardado.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Reordenar en `pages-5000.pdf` y guardar; el índice y los enlaces apuntan a las páginas correctas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->

### [programador] ronda 1 — 2026-10-19
- Ficheros cambiados: `boveda/Apps/Lector PDF/Tareas/PDF-053-organizar-paginas.md` (solo estado y fecha).
- Qué he hecho: no he implementado nada. La ficha está marcada como «por detallar»: no define firmas, ficheros, pasos ni criterios concretos, y el propio texto dice que no hay que empezar hasta que el líder la complete. Tampoco hay decisiones de diseño tomadas (p. ej., formato de los cambios de orden de página, cómo se guarda el giro, si el borrado va en el mismo comando de deshacer).
- Comandos ejecutados y resultado: ninguno (no hay código que verificar).
- Dudas o cosas que no he podido hacer: falta que el líder detalle la ficha (firmas, ficheros, pasos, criterios de aceptación y «Fuera de alcance») y confirme si requiere ADR. Dependencia PDF-052 (`boveda/Apps/Lector PDF/Tareas/PDF-052-organizar-adr.md`): no he revisado su estado. Ficha pasada a `bloqueada`.
