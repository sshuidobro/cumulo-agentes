---
tipo: decision
id: ADR-0044
app: pdf
estado: aceptada
fecha: 2026-10-21
creado: 2026-10-21
actualizado: 2026-10-21
tags: [decision, pdf, distribucion, ci]
---

# ADR-0044 · Instaladores del Lector PDF fabricados en GitHub Actions

## Contexto
El usuario quiere instalar el Lector PDF en su escritorio sin compilarlo él (Rust, C++ Build Tools, Node y pnpm, unos 30 min la primera vez). Pide que lo haga el equipo «sin gastar demasiados recursos». El repositorio no tenía ninguna automatización. En un repositorio privado, GitHub Actions cuenta los minutos de Windows ×2 y los de macOS ×10 sobre la cuota mensual.

## Opciones consideradas
| Opción | Ventajas | Inconvenientes | Coste |
|---|---|---|---|
| A. Workflow manual (`workflow_dispatch`) que fabrica y publica en una release | Solo gasta cuando se pide; descarga directa desde GitHub | Hay que lanzarlo (lo hace el equipo) | ~20–40 min de cuota por fabricación de Windows; menos con caché |
| B. Fabricar en cada push a `main` | Siempre al día | Gasta minutos en cada fusión aunque nadie instale | Alto |
| C. `tauri-apps/tauri-action` | Menos YAML | Dependencia externa más; no aporta nada que no hagan dos órdenes | Igual que A |

## Decisión
Opción **A** en `.github/workflows/instaladores-lector-pdf.yml`:
- Por defecto solo **Windows**, con un único instalador NSIS publicado como `Instalar-Lector-PDF.exe` (sin MSI, para no confundir). Linux (`.deb`, AppImage) y macOS (`.dmg`) se eligen en el desplegable; macOS solo si el usuario lo pide, por su coste.
- Caché de Rust con `Swatinem/rust-cache` para que las siguientes fabricaciones tarden mucho menos.
- Publica en la release `lector-pdf-v<versión de tauri.conf.json>`, marcada como la última, para que `releases/latest/download/Instalar-Lector-PDF.exe` sea un enlace fijo; si ya existe, reemplaza los ficheros.
- Sin acciones de terceros más allá de las oficiales de GitHub y la caché de Rust.

## Revisión 2026-10-21 · instalable por cualquiera
El usuario quiere pasárselo a su madre: doble clic y aceptar, y autoriza hacer público el repositorio. En `tauri.conf.json`:
- `nsis.installMode: currentUser`: se instala en la carpeta del usuario, sin pedir permisos de administrador.
- Instalador solo en español, sin selector de idioma.
- `webviewInstallMode: embedBootstrapper`: si el equipo no tiene WebView2 (Windows 10 antiguo), lo instala sin pasos extra.
- Editor, categoría y descripción rellenos para que aparezcan bien en «Aplicaciones instaladas».

Con el repositorio público, la descarga no pide cuenta de GitHub y los minutos de Actions son gratis.

## Consecuencias
- Los instaladores **no están firmados**: Windows muestra SmartScreen y macOS Gatekeeper la primera vez. Firmar exige un certificado de pago (decisión de producto del usuario si algún día se quiere).
- Mientras el repositorio sea privado, la release solo la descarga quien tenga acceso.
- La guía de instalación pasa a ofrecer primero la descarga y deja la compilación como alternativa.
