// node --test 'herramientas/oficina-2d/pruebas/*.test.mjs'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
/* global process */
import { estadoDeNotas, seguidorGithub } from '../estado.mjs';

const ficha = (id, estado) => `---\ntipo: tarea\nid: ${id}\ntitulo: Ficha ${id}\napp: pdf\nestado: ${estado}\nintentos: 0\n---\n# ${id}\n`;

test('clasifica fichas, planes e investigaciones por su ruta en la bóveda', () => {
  const r = estadoDeNotas([
    ['Apps/PDF/Tareas/PDF-001.md', ficha('PDF-001', 'en-curso')],
    ['Apps/PDF/Plan.md', '---\ntipo: plan\napp: pdf\nestado: borrador\n---\n'],
    ['Investigacion/Formatos.md', '---\ntipo: investigacion\nestado: en-curso\n---\n'],
    ['Plantillas/Tarea.md', ficha('PDF-000', 'en-curso')],
  ]);
  const estado = Object.fromEntries(r.agentes.map((a) => [a.id, a.estado]));
  assert.equal(estado['programador-1'], 'trabajando');
  assert.equal(estado['programador-2'], 'parado');
  assert.equal(estado.lider, 'trabajando');
  assert.equal(estado.investigador, 'trabajando');
  assert.equal(r.total, 1);
});

test('sigue la rama remota con el cambio más reciente sin tocar la carpeta local', async () => {
  const base = mkdtempSync(join(tmpdir(), 'oficina-'));
  const g = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  const antiguo = { ...process.env, GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z', GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z' };
  try {
    const origen = join(base, 'origen.git');
    const equipo = join(base, 'equipo');
    const mio = join(base, 'mio');
    execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', origen]);
    execFileSync('git', ['clone', '--quiet', origen, equipo], { stdio: 'pipe' });
    mkdirSync(join(equipo, 'boveda/Apps/PDF/Tareas'), { recursive: true });
    writeFileSync(join(equipo, 'boveda/Apps/PDF/Tareas/PDF-001.md'), ficha('PDF-001', 'hecha'));
    g(equipo, 'add', '.');
    execFileSync('git', ['-C', equipo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'inicio'], { stdio: 'pipe', env: antiguo });
    g(equipo, 'push', '--quiet', 'origin', 'main');
    execFileSync('git', ['clone', '--quiet', origen, mio], { stdio: 'pipe' });

    // El equipo trabaja en otra rama y sube un cambio de estado.
    g(equipo, 'checkout', '--quiet', '-b', 'trabajo');
    writeFileSync(join(equipo, 'boveda/Apps/PDF/Tareas/PDF-002.md'), ficha('PDF-002', 'en-revision'));
    g(equipo, 'add', '.');
    g(equipo, 'commit', '--quiet', '-m', 'PDF-002 a revisión');
    g(equipo, 'push', '--quiet', 'origin', 'trabajo');

    const r = await seguidorGithub(mio)();
    assert.equal(r.fuente, 'github');
    assert.equal(r.rama, 'trabajo');
    assert.equal(r.aviso, '');
    assert.equal(r.agentes.find((a) => a.id === 'revisor').tarea.id, 'PDF-002');

    const soloMain = await seguidorGithub(mio, 'main')();
    assert.equal(soloMain.agentes.find((a) => a.id === 'revisor').estado, 'parado');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
