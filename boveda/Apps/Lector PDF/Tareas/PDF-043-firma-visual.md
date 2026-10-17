---
tipo: tarea
id: PDF-043
titulo: Firma visual (dibujar, escribir o imagen)
app: pdf
estado: pendiente
depende_de: [PDF-039]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-3, firma, anotaciones, por-detallar]
---

# PDF-043 · Firma visual (dibujar, escribir o imagen)

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Crear una firma (dibujada, tecleada con fuente manuscrita libre o imagen PNG/JPEG), guardarla localmente para reutilizarla y colocarla como anotación `Stamp` con `/AP` en cualquier página. No es firma digital (PDF-066).

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Colocar, mover y redimensionar la firma; se guarda dentro del PDF y se ve en pdf.js y qpdf; las firmas guardadas no salen del equipo.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
