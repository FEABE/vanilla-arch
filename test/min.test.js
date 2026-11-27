'use strict';
// vanilla-arch.min.js must behave exactly like vanilla-arch.js: the whole suite runs again against it
// (VANILLA_ARCH_MIN=1), and when the vanilla-kit minifier is available the file must be up to date.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { build, kitCli } = require('../scripts/build-min.js');

const ROOT = path.join(__dirname, '..');
const MIN = path.join(ROOT, 'vanilla-arch.min.js');

test('vanilla-arch.min.js exists, keeps the license line and the same version', () => {
    const min = fs.readFileSync(MIN, 'utf8');
    const src = fs.readFileSync(path.join(ROOT, 'vanilla-arch.js'), 'utf8');
    assert.equal(min.split('\n')[0], src.split('\n')[0]);
    assert.match(min, /^\/\*! vanilla-arch \d+\.\d+\.\d+ \| MIT License/);
    assert.ok(min.length < src.length * 0.65, min.length + ' / ' + src.length);
    assert.ok(!/\r/.test(min));
});

test('vanilla-arch.min.js is up to date with the source', { skip: kitCli() ? false : 'vanilla-kit not found (set VANILLA_KIT)' }, () => {
    assert.equal(fs.readFileSync(MIN, 'utf8'), build(), 'run node scripts/build-min.js');
});

test('the whole suite passes against vanilla-arch.min.js', { skip: process.env.VANILLA_ARCH_MIN === '1' }, () => {
    const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js') && f !== 'min.test.js').map((f) => path.join(__dirname, f));
    const env = Object.assign({}, process.env, { VANILLA_ARCH_MIN: '1' });
    delete env.NODE_TEST_CONTEXT;   // run as a fresh test process, not nested in this one
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', ...files], { cwd: ROOT, encoding: 'utf8', env });
    const tail = (r.stdout || '').slice(-4000) + (r.stderr || '').slice(-2000);
    assert.equal(r.status, 0, tail);
    assert.match(r.stdout, /ℹ fail 0/, tail);
});
