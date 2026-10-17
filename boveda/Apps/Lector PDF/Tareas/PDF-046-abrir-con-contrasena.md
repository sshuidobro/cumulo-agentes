---
tipo: tarea
id: PDF-046
titulo: Abrir PDF con contraseña
app: pdf
estado: pendiente
depende_de: [PDF-022]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-4, seguridad, por-detallar]
---

# PDF-046 · Abrir PDF con contraseña

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Pedir la contraseña con un diálogo propio (`onPassword` de pdf.js), reintentar si es incorrecta y no guardarla nunca en disco. Fixtures cifrados generados (RC4 40/128, AES-128, AES-256) con `qpdf --encrypt` en el script de fixtures.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Abrir los 4 cifrados con la contraseña correcta; mensaje «La contraseña no es correcta.» con la incorrecta; cancelar vuelve al estado vacío.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
