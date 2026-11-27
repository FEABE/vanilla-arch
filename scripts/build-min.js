#!/usr/bin/env node
/**
 * scripts/build-min.js — builds vanilla-arch.min.js with the vanilla-kit minifier CLI (no third-party tools).
 *
 *   node scripts/build-min.js           write vanilla-arch.min.js
 *   node scripts/build-min.js --check   exit 1 if vanilla-arch.min.js is missing or out of date
 *
 * The kit is looked up in VANILLA_KIT (a vanilla-kit checkout) or next to this repository (../vanilla-kit).
 * The CLI normalizes line endings, so the output is byte-identical on every OS.
 */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'vanilla-arch.js');
const OUT = path.join(ROOT, 'vanilla-arch.min.js');

function kitCli() {
    const kit = process.env.VANILLA_KIT || path.join(ROOT, '..', 'vanilla-kit');
    const cli = path.join(kit, 'bin', 'minify.js');
    return fs.existsSync(cli) ? cli : null;
}

function build() {
    const cli = kitCli();
    if (!cli) throw new Error('vanilla-kit not found: set VANILLA_KIT to a vanilla-kit checkout');
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'va-min-')), 'out.js');
    const r = spawnSync(process.execPath, [cli, SRC, '-o', tmp], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('minify failed: ' + r.stderr);
    if (r.stderr) throw new Error('minify: ' + r.stderr.trim());   // e.g. names were not shortened
    const code = fs.readFileSync(tmp, 'utf8');
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    return code;
}

if (require.main === module) {
    const code = build();
    if (process.argv.includes('--check')) {
        const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
        if (now !== code) { process.stdout.write('vanilla-arch.min.js is out of date\n'); process.exit(1); }
        process.stdout.write('vanilla-arch.min.js is up to date\n');
    } else {
        fs.writeFileSync(OUT, code);
        process.stdout.write('vanilla-arch.min.js  ' + fs.statSync(SRC).size + ' -> ' + Buffer.byteLength(code) + ' bytes\n');
    }
}

module.exports = { build, kitCli };
