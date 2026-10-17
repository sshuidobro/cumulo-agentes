---
tipo: tarea
id: PDF-060
titulo: Proteger con contraseña y permisos
app: pdf
estado: pendiente
depende_de: [PDF-052, PDF-047]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-6, seguridad, por-detallar]
---

# PDF-060 · Proteger con contraseña y permisos

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Cifrar un PDF con AES-256 y contraseña de apertura y/o de permisos, y quitar la protección conociendo la contraseña.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] El PDF protegido pide contraseña en pdf.js y `qpdf --show-encryption` muestra AES-256.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
