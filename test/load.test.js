'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'vanilla-arch.js'), 'utf8');

test('as a classic <script>: defines window.VanillaArch and nothing else', () => {
  const window = {};
  const ctx = vm.createContext({ window });
  vm.runInContext(src, ctx);
  assert.equal(typeof window.VanillaArch.create, 'function');
  assert.deepEqual(Object.keys(window), ['VanillaArch']);
  assert.equal(typeof ctx.module, 'undefined');
});

test('as CommonJS: module.exports without touching window', () => {
  const module = { exports: {} };
  vm.runInContext(src, vm.createContext({ module }));
  assert.equal(typeof module.exports.validate, 'function');
});

test('source is plain ES5-style script: no import/export, no third-party references', () => {
  assert.ok(!/^\s*(import|export)\s/m.test(src));
  assert.ok(!/require\(/.test(src));
});
