#!/usr/bin/env node
// Índice compacto del código: qué exporta cada fichero y en qué línea.
// Sirve para que los agentes localicen código sin leer ficheros enteros.
// Uso:
//   node scripts/indice-codigo.mjs [rutas...] [--buscar <regex>] [--tests]
//   node scripts/indice-codigo.mjs apps/lector-pdf/src --buscar signature
// Sin rutas indexa apps/*/src y packages/*/src. Siempre genera el índice
// en el momento, así que nunca está desactualizado ni provoca conflictos.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const args = process.argv.slice(2);
const roots = [];
let pattern = null;
let withTests = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--buscar') pattern = new RegExp(args[++i] ?? '', 'i');
  else if (args[i] === '--tests') withTests = true;
  else roots.push(args[i]);
}

const repo = new URL('..', import.meta.url).pathname;
if (roots.length === 0) {
  for (const group of ['apps', 'packages']) {
    let entries;
    try { entries = readdirSync(join(repo, group)); } catch { continue; }
    for (const name of entries) roots.push(join(group, name, 'src'));
  }
}

const SKIP = new Set(['node_modules', 'dist', 'coverage', 'target', 'gen', 'public']);
const EXT = /\.(ts|tsx|mts|js|mjs|rs)$/;
const EXPORT = /^export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(function\*?|const|let|class|interface|type|enum|abstract\s+class)\s+([A-Za-z0-9_$]+)/;
const REEXPORT = /^export\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/;
const RUST = /^pub(?:\(crate\))?\s+(?:async\s+)?(fn|struct|enum|trait|type|const)\s+([A-Za-z0-9_]+)/;

function walk(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (EXT.test(name) && (withTests || !/\.(test|spec|perf\.test)\./.test(name))) out.push(path);
  }
}

const files = [];
for (const root of roots) walk(join(repo, root), files);
files.sort();

let shown = 0;
for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const symbols = [];
  lines.forEach((line, i) => {
    const m = EXPORT.exec(line) ?? RUST.exec(line);
    if (m) symbols.push(`${m[2]}:${i + 1}`);
    const r = REEXPORT.exec(line);
    if (r) symbols.push(`{${r[1].trim().replace(/\s+/g, ' ')}} de ${r[2]}:${i + 1}`);
  });
  const rel = relative(repo, file);
  if (pattern && !pattern.test(rel) && !symbols.some((s) => pattern.test(s))) continue;
  process.stdout.write(`${rel} (${lines.length} l.)${symbols.length ? ': ' + symbols.join(', ') : ''}\n`);
  shown++;
}
process.stderr.write(`${shown} ficheros\n`);
