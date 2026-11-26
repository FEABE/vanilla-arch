'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VA = require('../vanilla-arch.js');
const shop = require('../examples/shop.json');
const minimal = require('../examples/minimal.json');

const clone = (o) => JSON.parse(JSON.stringify(o));
const has = (list, re) => list.some((p) => re.test(p));

test('loads in Node without a DOM and exposes the API', () => {
  for (const k of ['create', 'validate', 'iconOf']) assert.equal(typeof VA[k], 'function', k);
  assert.match(VA.version, /^\d+\.\d+\.\d+$/);
  assert.ok(Array.isArray(VA.ICONS) && VA.ICONS.includes('server'));
  assert.ok(Object.isFrozen(VA.LIGHT) && Object.isFrozen(VA.DARK));
  assert.deepEqual(Object.keys(VA.LIGHT).sort(), Object.keys(VA.DARK).sort());
  for (const v of Object.values(VA.LIGHT).concat(Object.values(VA.DARK))) assert.match(v, /^rgb\(\d+, \d+, \d+\)$/);
  assert.equal(typeof globalThis.VanillaArch, 'undefined', 'no global leak in Node');
});

test('create() throws a clear error without a DOM', () => {
  assert.throws(() => VA.create({}, minimal), /needs a browser DOM/);
});

test('bundled examples are valid', () => {
  assert.deepEqual(VA.validate(shop), []);
  assert.deepEqual(VA.validate(minimal), []);
});

test('minimal data: only nodes are required', () => {
  assert.deepEqual(VA.validate({ nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }] }), []);
  assert.deepEqual(VA.validate({ nodes: [] }), []);
});

test('rejects non-objects and missing nodes', () => {
  assert.deepEqual(VA.validate(null), ['data must be an object']);
  assert.ok(has(VA.validate({}), /nodes must be an array/));
});

test('duplicate and missing node ids', () => {
  const p = VA.validate({ nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }, { id: 'a', label: 'B', x: 1, y: 1 }, { label: 'C', x: 2, y: 2 }] });
  assert.ok(has(p, /nodes\[1\] "a": duplicate node id/));
  assert.ok(has(p, /nodes\[2\]: missing id/));
});

test('missing or non-numeric coordinates', () => {
  const p = VA.validate({ nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B', x: '1', y: 2 }, { id: 'c', label: 'C', x: NaN, y: 0 }] });
  assert.equal(p.filter((s) => /x and y must be numbers/.test(s)).length, 3);
});

test('unknown node ids in edges', () => {
  const d = clone(minimal);
  d.edges.push(['api', 'nope'], ['ghost', 'db'], ['api']);
  const p = VA.validate(d);
  assert.ok(has(p, /edges\[3\]: unknown node id "nope"/));
  assert.ok(has(p, /edges\[4\]: unknown node id "ghost"/));
  assert.ok(has(p, /edges\[5\]: must be \[fromId, toId, kind\?\]/));
});

test('scenario flows: unknown ids, short paths, unknown kinds, bad timing', () => {
  const d = clone(shop);
  d.scenarios[0].flows.push({ path: ['orders', 'nowhere'], kind: 'req' });
  d.scenarios[0].flows.push({ path: ['orders'], kind: 'req' });
  d.scenarios[0].flows.push({ path: ['orders', 'db'], kind: 'teleport', every: -5, delay: 'soon' });
  const p = VA.validate(d);
  assert.ok(has(p, /scenarios\[0\] "checkout"\.flows\[5\]: unknown node id "nowhere"/));
  assert.ok(has(p, /flows\[6\]: path must list at least 2 node ids/));
  assert.ok(has(p, /flows\[7\]: unknown kind "teleport"/));
  assert.ok(has(p, /flows\[7\]: every must be a positive number/));
  assert.ok(has(p, /flows\[7\]: delay must be a number/));
});

test('scenario ids: missing, duplicate, flows not an array', () => {
  const p = VA.validate({ nodes: [], scenarios: [{ id: 's', flows: [] }, { id: 's', flows: [] }, { flows: 'x' }] });
  assert.ok(has(p, /scenarios\[1\] "s": duplicate scenario id/));
  assert.ok(has(p, /scenarios\[2\]: missing id/));
  assert.ok(has(p, /scenarios\[2\]: flows must be an array/));
});

test('zones: rectangle or polygon, layers, flags', () => {
  const base = { layers: [{ id: 'l1', label: 'L1' }], nodes: [] };
  assert.deepEqual(VA.validate({ ...base, zones: [{ id: 'z', x: 0, y: 0, w: 2, h: 2, layer: 'l1' }, { id: 'p', pts: [[0, 0], [1, 0], [1, 1]], flag: [0, 0] }] }), []);
  const p = VA.validate({ ...base, zones: [{ id: 'z', x: 0, y: 0, w: 2 }, { id: 'z', pts: [[0, 0], [1, 1]] }, { id: 'q', x: 0, y: 0, w: 1, h: 1, layer: 'nope', flag: 'top' }] });
  assert.ok(has(p, /zones\[0\] "z": needs x, y, w, h numbers/));
  assert.ok(has(p, /zones\[1\] "z": duplicate zone id/));
  assert.ok(has(p, /zones\[1\] "z": pts must be at least 3/));
  assert.ok(has(p, /zones\[2\] "q": unknown layer "nope"/));
  assert.ok(has(p, /zones\[2\] "q": flag must be \[x, y\]/));
});

test('node details: unknown layer, unknown icon, bad s / stack / tech, style', () => {
  const p = VA.validate({
    style: 'flat',
    layers: [{ id: 'l1' }, { id: 'l1' }],
    nodes: [{ id: 'a', label: 'A', x: 0, y: 0, layer: 'l2', icon: 'rocket', s: 0, stack: 0.5, tech: 'x' }]
  });
  assert.ok(has(p, /style: only "iso" is supported/));
  assert.ok(has(p, /layers\[1\]: duplicate layer id "l1"/));
  assert.ok(has(p, /unknown layer "l2"/));
  assert.ok(has(p, /unknown icon "rocket"/));
  assert.ok(has(p, /s must be a positive number/));
  assert.ok(has(p, /stack must be a number >= 1/));
  assert.ok(has(p, /tech must be an array/));
});

test('layers are optional: node layers are not checked when no layers are declared', () => {
  assert.deepEqual(VA.validate({ nodes: [{ id: 'a', label: 'A', x: 0, y: 0, layer: 'anything' }] }), []);
});

test('validate() does not mutate its input', () => {
  const d = clone(shop), before = JSON.stringify(d);
  VA.validate(d);
  assert.equal(JSON.stringify(d), before);
});
