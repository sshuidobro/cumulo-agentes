---
tipo: tarea
id: PDF-066
titulo: Firma digital con certificado
app: pdf
estado: pendiente
depende_de: [PDF-043, PDF-052]
intentos: 0
skills: [formatos-ofimatica, stack-typescript-react, calidad-profesional, pruebas-calidad]
creado: 2026-10-17
actualizado: 2026-10-17
tags: [tarea, pdf, iteracion-6, firma, seguridad, por-detallar]
---

# PDF-066 · Firma digital con certificado

Plan: [[Apps/Lector PDF/Plan|Plan]] (iteración 6) · Paridad: [[Paridad Adobe Acrobat]]

> **Ficha por detallar.** El líder la completará (firmas, ficheros, pasos y criterios exactos, y ADR si hace falta) al cerrar la iteración anterior. No empezar hasta entonces.

## Objetivo
Firmar con un certificado personal (PKCS#12) generando una firma PAdES básica por actualización incremental, y validar firmas existentes. Requiere ADR de librería criptográfica.

## Contexto
- Leer cuando se detalle: [[Paridad Adobe Acrobat]], [[Librerias y arquitectura PDF]] y los ADR enlazados en el Plan.

## Qué hay que hacer
Por detallar.

## Criterios de aceptación
- [ ] Un PDF firmado por la app aparece como firmado en `pdfsig` (poppler) y en Adobe (lista manual).
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm coverage`, `pnpm --filter lector-pdf e2e` con código 0; presupuestos de rendimiento del Plan sin regresiones.

## Fuera de alcance
- Por detallar.

## Registro
<!-- Cada agente añade aquí su entrada al terminar; no borrar las anteriores. -->
