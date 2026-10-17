// node --test 'herramientas/oficina-2d/pruebas/*.test.mjs'
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { derivarEquipo, leerFrontmatter, VIVO_CADUCA_MS } from '../derivar.mjs';
import { Simulacion } from '../simulacion.mjs';

const ficha = (id, estado, extra = {}) => ({ id, titulo: `Ficha ${id}`, app: 'pdf', estado, intentos: 0, ...extra });
const agente = (r, id) => r.agentes.find((a) => a.id === id);

test('lee el frontmatter de una ficha con comentarios y listas', () => {
  const datos = leerFrontmatter('---\ntipo: tarea\nid: PDF-004\nestado: en-curso   # pendiente | hecha\ndepende_de: [PDF-001, PDF-002]\nintentos: 2\n---\n# Título');
  assert.deepEqual(datos, { tipo: 'tarea', id: 'PDF-004', estado: 'en-curso', depende_de: ['PDF-001', 'PDF-002'], intentos: 2 });
  assert.deepEqual(leerFrontmatter('sin frontmatter'), {});
});

test('sin fichas abiertas todo el equipo está parado', () => {
  const r = derivarEquipo({ fichas: [ficha('COM-001', 'hecha'), ficha('COM-002', 'sustituida')] });
  assert.equal(r.agentes.length, 7);
  assert.ok(r.agentes.every((a) => a.estado === 'parado' && a.tarea === null));
  assert.deepEqual(r.fichas, { hecha: 1, sustituida: 1 });
});

test('cada ficha en curso ocupa a un programador y el resto queda parado', () => {
  const r = derivarEquipo({ fichas: [ficha('PDF-010', 'en-curso'), ficha('PDF-002', 'en-curso'), ficha('PDF-003', 'pendiente')] });
  assert.equal(agente(r, 'programador-1').tarea.id, 'PDF-002');
  assert.equal(agente(r, 'programador-2').tarea.id, 'PDF-010');
  assert.equal(agente(r, 'programador-3').estado, 'parado');
});

test('con más fichas en curso que programadores lo indica en el tercero', () => {
  const fichas = ['1', '2', '3', '4', '5'].map((n) => ficha(`PDF-00${n}`, 'en-curso'));
  assert.equal(agente(derivarEquipo({ fichas }), 'programador-3').detalle, 'y 2 más en curso');
});

test('revisor y tester trabajan cuando hay fichas en su cola', () => {
  const r = derivarEquipo({ fichas: [ficha('PDF-001', 'en-revision'), ficha('PDF-002', 'en-revision'), ficha('PDF-003', 'en-test')] });
  assert.equal(agente(r, 'revisor').estado, 'trabajando');
  assert.equal(agente(r, 'revisor').detalle, 'Revisando · 1 más en cola');
  assert.equal(agente(r, 'tester').tarea.id, 'PDF-003');
});

test('el líder replanifica fichas bloqueadas o con tres rechazos y planifica borradores', () => {
  assert.equal(agente(derivarEquipo({ fichas: [ficha('PDF-001', 'bloqueada')] }), 'lider').detalle, 'Ficha bloqueada');
  assert.equal(agente(derivarEquipo({ fichas: [ficha('PDF-001', 'cambios-pedidos', { intentos: 3 })] }), 'lider').estado, 'trabajando');
  assert.equal(agente(derivarEquipo({ fichas: [ficha('PDF-001', 'hecha', { intentos: 3 })] }), 'lider').estado, 'parado');
  const plan = agente(derivarEquipo({ fichas: [], planes: [{ app: 'pdf', estado: 'borrador' }] }), 'lider');
  assert.equal(plan.estado, 'trabajando');
  assert.equal(plan.tarea.id, 'Plan pdf');
});

test('el investigador trabaja si hay una investigación en curso', () => {
  const r = derivarEquipo({ fichas: [], investigaciones: [{ estado: 'en-curso', titulo: 'Paridad Adobe Acrobat' }] });
  assert.equal(agente(r, 'investigador').estado, 'trabajando');
});

test('el estado en vivo manda si es reciente y se ignora si ha caducado', () => {
  const ahora = Date.parse('2026-10-17T12:00:00Z');
  const vivo = (hace) => ({
    actualizado: new Date(ahora - hace).toISOString(),
    agentes: { investigador: { estado: 'trabajando', tarea: 'Formatos PDF' }, 'programador-1': { estado: 'parado' }, intruso: { estado: 'trabajando' } },
  });
  const fichas = [ficha('PDF-001', 'en-curso')];
  const r = derivarEquipo({ fichas, vivo: vivo(1000), ahora });
  assert.deepEqual(agente(r, 'investigador').tarea, { id: 'Formatos PDF', titulo: '', app: '' });
  assert.equal(agente(r, 'investigador').origen, 'vivo');
  assert.equal(agente(r, 'programador-1').estado, 'parado');
  assert.equal(r.agentes.length, 7);
  const viejo = derivarEquipo({ fichas, vivo: vivo(VIVO_CADUCA_MS + 1), ahora });
  assert.equal(agente(viejo, 'investigador').estado, 'parado');
  assert.equal(agente(viejo, 'programador-1').estado, 'trabajando');
  assert.equal(agente(derivarEquipo({ fichas, vivo: { actualizado: 'mal', agentes: {} }, ahora }), 'programador-1').estado, 'trabajando');
});

test('la simulación recorre todo el flujo y vuelve a empezar', () => {
  const sim = new Simulacion(3);
  const vistos = new Set();
  let algunoParado = false;
  for (let i = 0; i < 200; i++) {
    const e = sim.estado();
    for (const a of e.agentes) if (a.estado === 'trabajando') vistos.add(a.rol);
    if (e.agentes.some((a) => a.estado === 'parado')) algunoParado = true;
    if (sim.fase === 'cerrado') break;
    sim.paso();
  }
  assert.equal(sim.fase, 'cerrado');
  assert.deepEqual([...vistos].sort(), ['investigador', 'lider', 'programador', 'revisor', 'tester']);
  assert.ok(algunoParado);
});
