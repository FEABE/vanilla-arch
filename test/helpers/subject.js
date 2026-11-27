'use strict';
// The file under test: vanilla-arch.js, or vanilla-arch.min.js when VANILLA_ARCH_MIN=1 (see test/min.test.js).
const path = require('node:path');

const MINIFIED = process.env.VANILLA_ARCH_MIN === '1';
const file = path.join(__dirname, '..', '..', MINIFIED ? 'vanilla-arch.min.js' : 'vanilla-arch.js');
module.exports = { file, minified: MINIFIED, load: () => require(file) };
