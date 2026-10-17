---
tipo: tarea
id: PDF-054
titulo: Extraer y dividir
app: pdf
estado: pendiente
depende_de: [PDF-053]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-5, organizar, por-detallar]
---

# PDF-054 · Extraer y dividir

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 5) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Extraer un rango a un PDF nuevo y dividir por número de páginas, por marcadores de primer nivel o por tamaño.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Dividir `outline.pdf` por capítulos produce 4 ficheros con las páginas esperadas.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
