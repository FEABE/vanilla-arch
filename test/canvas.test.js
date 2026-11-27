'use strict';
// Canvas size limits: a drawing never asks the browser for a canvas larger than LIMITS, whatever the coordinates.
const test = require('node:test');
const assert = require('node:assert/strict');
const VA = require('./helpers/subject.js').load();
const shop = require('../examples/shop.json');

const { maxSide, maxPixels } = VA.LIMITS;
const fit = VA._fitCanvas;
function within(r, note) {
    assert.ok(isFinite(r.U) && r.U > 0, note + ' U ' + r.U);
    assert.ok(r.CW <= maxSide && r.H <= maxSide, note + ' side ' + r.CW + 'x' + r.H);
    assert.ok(Math.round(r.CW * r.dpr) * Math.round(r.H * r.dpr) <= maxPixels, note + ' pixels ' + r.CW + 'x' + r.H + '@' + r.dpr);
    assert.ok(r.dpr > 0, note + ' dpr');
}

test('LIMITS are exposed and frozen', () => {
    assert.ok(Object.isFrozen(VA.LIMITS));
    assert.ok(maxSide >= 4096 && maxPixels >= 16e6 && maxPixels <= 32e6);
});

test('ordinary drawings keep the readable cell size and the requested pixel ratio', () => {
    const r = fit(12, 8, 900, 2);
    assert.ok(r.U >= 30 && r.U <= 44, String(r.U));
    assert.equal(r.dpr, 2);
    assert.equal(r.scaled, false);
    assert.equal(r.CW, 900);
    // narrow host: the drawing gets wider than the host (it scrolls) but keeps U >= 30
    const n = fit(30, 10, 320, 1);
    assert.equal(n.U, 30);
    assert.ok(n.CW > 320);
});

test('huge coordinate spans are scaled down to fit, never thrown', () => {
    for (const [w, h] of [[10000 * 0.866, 1], [1, 20000], [1e6, 1e6], [1e300, 3], [5000, 5000]]) {
        const r = fit(w, h, 900, 2);
        within(r, w + 'x' + h);
        assert.equal(r.scaled, true, w + 'x' + h);
    }
});

test('a big but readable canvas lowers the pixel ratio first', () => {
    const r = fit(150, 100, 900, 3);   // about 4500 x 3100 CSS px: fits at dpr 1, not at dpr 3
    within(r, 'big');
    assert.ok(r.U >= 30, String(r.U));
    assert.ok(r.dpr < 3);
});

test('broken input still gives a usable size', () => {
    for (const args of [[NaN, NaN, NaN, NaN], [Infinity, -Infinity, 0, 0], [-5, -5, -100, -1], [0, 0, 1e9, 1e9]]) {
        within(fit(...args), JSON.stringify(args));
    }
});

test('validate() warns about coordinate spans too big for one canvas', () => {
    const far = { nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }, { id: 'b', label: 'B', x: 10000, y: 0 }] };
    const out = VA.validate(far);
    assert.equal(out.length, 1, JSON.stringify(out));
    assert.match(out[0], /coordinates span 10001 x 1 grid units: too big for one canvas/);
    assert.deepEqual(VA.validate(shop), []);
    assert.ok(VA.validate({ zones: [{ x: 0, y: 0, w: 1, h: 50000 }], nodes: [] }).some((p) => /too big for one canvas/.test(p)));
    assert.deepEqual(VA.validate({ nodes: [{ id: 'a', label: 'A', x: 0, y: 0 }, { id: 'b', label: 'B', x: 60, y: 40 }] }), []);
});
