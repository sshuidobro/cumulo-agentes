import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// Política de seguridad (ADR-0007): el PDF es entrada no confiable; no se ejecuta JS del documento.
const CSP =
  "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; " +
  "object-src 'none'; base-uri 'none'; form-action 'none'";

function cspPlugin(): Plugin {
  return {
    name: 'lector-pdf-csp',
    apply: 'build',
    transformIndexHtml(html) {
      const meta = `<meta http-equiv="Content-Security-Policy" content="${CSP}">`;
      return html.replace('<head>', `<head>\n    ${meta}`);
    },
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  build: { target: 'es2023', sourcemap: true, manifest: true },
  worker: { format: 'es' },
  server: { port: 5173, strictPort: true },
});
