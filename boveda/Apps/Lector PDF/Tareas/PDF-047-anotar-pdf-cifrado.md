---
tipo: tarea
id: PDF-047
titulo: Guardar anotaciones en PDF cifrado
app: pdf
estado: pendiente
depende_de: [PDF-046, PDF-037]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-4, seguridad, anotaciones, formato, por-detallar]
---

# PDF-047 · Guardar anotaciones en PDF cifrado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 4) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Extender el lector de xref y el escritor incremental (ADR-0009) para cifrar los objetos nuevos con el mismo `/Encrypt` (RC4 y AES-128/256 con la clave derivada de la contraseña), en lugar de devolver `save-encrypted`.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Anotar y guardar los 4 fixtures cifrados; pdf.js y `qpdf --check --password=...` los leen con las anotaciones.
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
