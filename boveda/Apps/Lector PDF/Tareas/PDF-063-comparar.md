---
tipo: tarea
id: PDF-063
titulo: Comparar dos PDFs
app: pdf
estado: pendiente
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-6, ui, por-detallar]
---

# PDF-063 · Comparar dos PDFs

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Comparar dos versiones de un documento: diferencias de texto por página y vista de superposición visual.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Comparar `basic-5.pdf` con una copia con una palabra cambiada señala solo esa palabra.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
