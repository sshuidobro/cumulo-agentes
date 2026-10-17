// Lee la bóveda y calcula el estado del equipo para la oficina 2D.
//   node herramientas/oficina-2d/estado.mjs              imprime el estado en JSON
//   node herramientas/oficina-2d/estado.mjs --servir     abre la oficina en http://localhost:4173
//   node herramientas/oficina-2d/estado.mjs --servir --github
//        sigue al equipo aunque trabaje en otra máquina: cada 15 s descarga de GitHub
//        la rama con el último cambio (o la de --rama NOMBRE) y lee sus fichas.
// Opciones: --puerto N, --repo RUTA (por defecto, la raíz de este repositorio).
/* global process, URL */
import { execFile } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { derivarEquipo, leerFrontmatter } from './derivar.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));

async function listar(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function notas(dir) {
  const salida = [];
  for (const e of await listar(dir)) {
    if (!e.isFile() || extname(e.name) !== '.md') continue;
    const texto = await readFile(join(dir, e.name), 'utf8');
    salida.push({ titulo: basename(e.name, '.md'), ...leerFrontmatter(texto) });
  }
  return salida;
}

/** Agrupa las notas leídas (ruta relativa a boveda/ → texto) y deduce el estado del equipo. */
export function estadoDeNotas(notasPorRuta, vivo = null) {
  const fichas = [];
  const planes = [];
  const investigaciones = [];
  for (const [ruta, texto] of notasPorRuta) {
    const partes = ruta.split('/');
    const nota = { titulo: basename(ruta, '.md'), ...leerFrontmatter(texto) };
    if (partes[0] === 'Apps' && partes.length === 4 && partes[2] === 'Tareas' && nota.tipo === 'tarea') fichas.push(nota);
    else if (partes[0] === 'Apps' && partes.length === 3 && nota.tipo === 'plan') planes.push(nota);
    else if (partes[0] === 'Investigacion' && partes.length === 2 && nota.tipo === 'investigacion') investigaciones.push(nota);
  }
  return derivarEquipo({ fichas, planes, investigaciones, vivo });
}

export async function leerEstado(repo) {
  const boveda = join(repo, 'boveda');
  const fichas = [];
  const planes = [];
  for (const app of await listar(join(boveda, 'Apps'))) {
    if (!app.isDirectory()) continue;
    const carpeta = join(boveda, 'Apps', app.name);
    for (const n of await notas(join(carpeta, 'Tareas'))) if (n.tipo === 'tarea') fichas.push(n);
    for (const n of await notas(carpeta)) if (n.tipo === 'plan') planes.push(n);
  }
  const investigaciones = (await notas(join(boveda, 'Investigacion'))).filter((n) => n.tipo === 'investigacion');
  let vivo;
  try {
    vivo = JSON.parse(await readFile(join(repo, 'registros', 'estado-equipo.json'), 'utf8'));
  } catch {
    vivo = null; // No hay estado en vivo: se usa solo lo deducido de las fichas.
  }
  return {
    generado: new Date().toISOString(),
    fuente: 'boveda',
    ...derivarEquipo({ fichas, planes, investigaciones, vivo }),
  };
}

const git = promisify(execFile);
const SEGUNDOS_GITHUB = 15;

/**
 * Sigue el repositorio remoto: descarga con `git fetch` como mucho cada 15 s y
 * lee las fichas directamente de la rama remota, sin tocar la carpeta de trabajo.
 */
export function seguidorGithub(repo, rama = null) {
  const ejecutar = async (...args) => (await git('git', ['-C', repo, ...args], { maxBuffer: 32 * 1024 * 1024 })).stdout;
  let ultimaDescarga = 0;
  let descargando = null;
  let cache = null;
  let aviso = '';

  async function descargar() {
    try {
      await ejecutar('fetch', '--quiet', '--prune', 'origin');
      aviso = '';
    } catch (err) {
      aviso = `No se pudo descargar de GitHub: ${String(err.stderr || err.message).trim().split('\n')[0]}`;
    }
  }

  async function referencia() {
    if (rama) return `origin/${rama}`;
    // La rama remota con el commit más reciente: ahí está trabajando el equipo.
    const salida = await ejecutar('for-each-ref', '--sort=-committerdate', '--format=%(refname:short)', 'refs/remotes/origin');
    return salida.split('\n').map((r) => r.trim()).find((r) => r.startsWith('origin/') && r !== 'origin/HEAD') ?? 'origin/main';
  }

  return async function leer() {
    if (Date.now() - ultimaDescarga > SEGUNDOS_GITHUB * 1000) {
      ultimaDescarga = Date.now();
      descargando ??= descargar().finally(() => {
        descargando = null;
      });
      if (!cache) await descargando;
    }
    const ref = await referencia();
    const [commit, fecha] = (await ejecutar('log', '-1', '--format=%H%n%cI', ref)).trim().split('\n');
    if (!cache || cache.commit !== commit) {
      const rutas = (await ejecutar('ls-tree', '-r', '--name-only', commit, '--', 'boveda/Apps', 'boveda/Investigacion'))
        .split('\n')
        .filter((r) => r.endsWith('.md'));
      const notasPorRuta = [];
      for (const ruta of rutas) notasPorRuta.push([ruta.slice('boveda/'.length), await ejecutar('show', `${commit}:${ruta}`)]);
      cache = { commit, estado: estadoDeNotas(notasPorRuta) };
    }
    return {
      generado: new Date().toISOString(),
      fuente: 'github',
      rama: ref.replace(/^origin\//, ''),
      commit: commit.slice(0, 7),
      fechaCommit: fecha,
      aviso,
      ...cache.estado,
    };
  };
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const SERVIBLES = new Set(['index.html', 'derivar.mjs', 'oficina.mjs', 'simulacion.mjs']);

function servir(leer, puerto) {
  const servidor = createServer(async (req, res) => {
    const ruta = new URL(req.url ?? '/', 'http://localhost').pathname.slice(1) || 'index.html';
    try {
      if (ruta === 'estado.json') {
        res.writeHead(200, { 'content-type': TIPOS['.json'], 'cache-control': 'no-store' });
        res.end(JSON.stringify(await leer()));
        return;
      }
      if (!SERVIBLES.has(ruta)) {
        res.writeHead(404).end('No encontrado');
        return;
      }
      res.writeHead(200, { 'content-type': TIPOS[extname(ruta)] });
      res.end(await readFile(join(AQUI, ruta)));
    } catch (err) {
      res.writeHead(500).end(String(err));
    }
  });
  // Solo escucha en este ordenador: nada sale de la máquina.
  servidor.listen(puerto, '127.0.0.1', () => {
    process.stdout.write(`Oficina 2D en http://localhost:${puerto} (Ctrl+C para salir)\n`);
  });
}

const OPCIONES = new Set(['--servir', '--github', '--rama', '--puerto', '--repo']);

async function main(args) {
  const valor = (nombre, defecto) => {
    const i = args.indexOf(nombre);
    return i >= 0 && args[i + 1] ? args[i + 1] : defecto;
  };
  const repo = resolve(valor('--repo', join(AQUI, '..', '..')));
  const desconocidas = args.filter((a) => a.startsWith('-') && !OPCIONES.has(a));
  if (desconocidas.length) {
    process.stderr.write(`Opción desconocida: ${desconocidas.join(', ')}. Válidas: ${[...OPCIONES].join(', ')}\n`);
    process.exitCode = 1;
    return;
  }
  const leer = args.includes('--github') ? seguidorGithub(repo, valor('--rama', null)) : () => leerEstado(repo);
  if (args.includes('--servir')) {
    servir(leer, Number(valor('--puerto', '4173')));
  } else {
    process.stdout.write(`${JSON.stringify(await leer(), null, 2)}\n`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main(process.argv.slice(2));
}
