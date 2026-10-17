---
tipo: tarea
id: PDF-048
titulo: Respetar los permisos del documento
app: pdf
estado: pendiente
depende_de: [PDF-046]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-4, seguridad, por-detallar]
---

# PDF-048 · Respetar los permisos del documento

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Leer los permisos (`getPermissions()`) y aplicar los que afectan a un lector: copiar texto, imprimir, imprimir en alta calidad. Anotar se permite siempre (requisito del usuario), mostrando un aviso si el PDF lo prohíbe.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Fixture con permisos restringidos: copiar e imprimir deshabilitados con explicación; anotar posible con aviso.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
