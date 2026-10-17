---
tipo: tarea
id: PDF-042
titulo: Guardar formularios con apariencias
app: pdf
estado: pendiente
depende_de: [PDF-041, PDF-028]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-3, formularios, formato, por-detallar]
---

# PDF-042 · Guardar formularios con apariencias

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 3) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Guardar los valores (`/V`) y regenerar `/AP` de cada campo cambiado mediante el escritor incremental (PDF-028), con `NeedAppearances` intacto, de forma que Adobe muestre los valores.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Ida y vuelta con pdf.js y `qpdf --check`; los valores se ven al reabrir en nuestra app; lista manual de comprobación en Adobe.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
