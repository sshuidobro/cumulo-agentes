---
tipo: tarea
id: PDF-051
titulo: Lienzo de detalle para zoom alto
app: pdf
estado: pendiente
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-4, visor, rendimiento, por-detallar]
---

# PDF-051 · Lienzo de detalle para zoom alto

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Con zoom alto (hasta 6 400 %), dibujar solo la zona visible a resolución completa sobre el lienzo de página limitado (ADR-0007), como hace el visor de pdf.js.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] A 3 200 % el texto es nítido (comparación de píxeles con un render recortado de referencia) y ningún lienzo supera el límite de área.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
