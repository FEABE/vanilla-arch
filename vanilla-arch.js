/*! vanilla-arch 0.1.1 | MIT License | (c) 2026 FEABE */
/* Isometric architecture diagrams drawn with Canvas 2D. No dependencies, no build step.
 *
 *   VanillaArch.create(host, data, opts) -> { setScenario(id), select(id), toDataURL(), destroy() }
 *   VanillaArch.validate(data)           -> [problem, ...]   (pure, works in Node)
 *   VanillaArch.iconOf(node, rules?)     -> icon name        (pure, works in Node)
 *
 * Data (all coordinates are grid units; see README.md for the full schema):
 *   title?, layers?: [{ id, label }], zones?: [{ id, label?, layer?, tone?, x, y, w, h } | { pts: [[x, y], ...], flag? }],
 *   nodes: [{ id, label, x, y, layer?, icon?, kind?, s?, stack?, short?, desc?, tech? }],
 *   edges: [[fromId, toId, kind?]], scenarios?: [{ id, label?, flows: [{ path: [ids], kind, back?, every?, delay? }] }]
 *
 *   - Grid x runs to the lower right, y to the lower left, z goes up. Layout is never automatic: you place things.
 *   - Block shape follows the icon: db / cache -> cylinder, users / person -> standing figures, everything else -> box
 *     with the icon painted on its top face.
 *   - A scenario sends packets along its flows (back: true returns along the same path, kind 'block' stops with an x).
 *   - prefers-reduced-motion (or opts.still) draws the paths without moving packets.
 *   - Colors: opts.palette > CSS custom properties (<tokenPrefix>bg, ...) when they are defined > built-in LIGHT / DARK.
 *   - Drawing stops while the canvas is off screen or the tab is hidden, runs at most 30 frames per second,
 *     and naps after 18 s without input.
 *   - Hover shows a tooltip, click (or tap) calls opts.onSelect(node). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.VanillaArch = api;
})(typeof window !== 'undefined' ? window : null, function (root) {
  'use strict';

  var VERSION = '0.1.1';
  var SPEED = 0.30;            // packet speed, px / ms
  var ICON = 24;               // icon design size (px); scaled when drawn
  var DEFAULT_FONT = 'ui-monospace, "SF Mono", "Cascadia Mono", Menlo, Consolas, "Liberation Mono", monospace';

  //════════════ canvas size (pure) ════════════
  // Browsers fail or go blank above some canvas size (iOS Safari: 16,777,216 backing pixels in total).
  var LIMITS = Object.freeze({ maxSide: 8192, maxPixels: 16777216 });   // CSS px per side, backing pixels (after dpr)
  // Cell size bounds and paddings of the isometric layout (CSS px).
  var FIT = { umin: 30, umax: 44, padX: 16, padT: 26, padB: 40 };
  var ISO_CX = Math.cos(Math.PI / 6), ISO_SY = 0.5;   // grid -> screen: s = (x - y) * cx, t = (x + y) * sy
  // Size of a drawing spanW x spanH (in cell units) for a host W px wide at device pixel ratio wantDpr.
  // Normally the cell size U stays within [umin, umax]. A huge span lowers U below umin until each side fits
  // maxSide; a big canvas lowers dpr (and, if even dpr 1 is too much, U) until it fits maxPixels. Never throws.
  function fitCanvas(spanW, spanH, W, wantDpr) {
    spanW = isFinite(spanW) && spanW > 0 ? spanW : 0;
    spanH = isFinite(spanH) && spanH > 0 ? spanH : 0;
    W = Math.min(LIMITS.maxSide, isFinite(W) && W > 0 ? W : 280);
    var padW = FIT.padX * 2, padH = FIT.padT + FIT.padB;
    var U = spanW > 0 ? Math.max(FIT.umin, Math.min(FIT.umax, (W - padW) / spanW)) : FIT.umax;
    if (spanW > 0) U = Math.min(U, (LIMITS.maxSide - padW - 1) / spanW);
    if (spanH > 0) U = Math.min(U, (LIMITS.maxSide - padH - 1) / spanH);
    function size(u) { return [Math.max(W, Math.ceil(spanW * u + padW)), Math.ceil(spanH * u + padH)]; }
    var s = size(U);
    if (s[0] * s[1] > LIMITS.maxPixels) {   // even at dpr 1: shrink the cells (binary search, area grows with U)
      var lo = 0, hi = U;
      for (var k = 0; k < 60; k++) { var mid = (lo + hi) / 2; if (size(mid)[0] * size(mid)[1] <= LIMITS.maxPixels) lo = mid; else hi = mid; }
      U = lo; s = size(U);
    }
    var dpr = isFinite(wantDpr) && wantDpr > 0 ? wantDpr : 1;
    if (s[0] * s[1] * dpr * dpr > LIMITS.maxPixels) {
      dpr = Math.floor(Math.sqrt(LIMITS.maxPixels / (s[0] * s[1])) * 1000) / 1000;
      // the canvas is Math.round(CW * dpr) x Math.round(H * dpr): step down until the rounded size fits too
      while (dpr > 1 && Math.round(s[0] * dpr) * Math.round(s[1] * dpr) > LIMITS.maxPixels) dpr = Math.round(dpr * 1000 - 1) / 1000;
    }
    return { U: U, CW: s[0], H: s[1], dpr: dpr, scaled: U < FIT.umin };
  }

  // Icon names the renderer can draw. Anything else falls back to a plain rounded square.
  var ICONS = ['users', 'person', 'mobile', 'browser', 'server', 'db', 'cache', 'bucket', 'queue', 'lambda',
    'cloud', 'shield', 'bolt', 'chip', 'doc', 'clock', 'chart', 'bell', 'lock', 'git'];

  // Picking an icon from id + label + tech when node.icon is not given. First match wins, so order matters.
  // Replace the whole list with opts.iconRules (e.g. myRules.concat(VanillaArch.ICON_RULES)).
  var ICON_RULES = [
    ['users', /\busers?\b|customer|visitor|shopper|member|사용자|고객|회원|방문자/],
    ['person', /admin|operator|\bstaff\b|support|\bperson\b|관리자|운영자|담당자/],
    ['mobile', /mobile|\bios\b|android|모바일/],
    ['bell', /notif|alert|alarm|e-?mail|\bsms\b|\bpush\b|알림/],
    ['chart', /\blogs?\b|logging|metric|monitor|dashboard|analytic|tracing|grafana|prometheus|모니터링|로그|지표/],
    ['git', /\bgit|\bci\b|ci\/cd|cicd|pipeline|\bbuild|배포|빌드/],
    ['lock', /\bauth|login|oauth|\bsso\b|identity|인증|로그인/],
    ['shield', /gateway|firewall|\bwaf\b|proxy|load ?balancer|\blb\b|ingress|nginx|\bedge\b|게이트웨이|방화벽/],
    ['bolt', /websocket|webhook|socket|realtime|real-time|\bevents?\b|실시간/],
    ['queue', /queue|kafka|rabbit|\bmq\b|\bsqs\b|\bnats\b|pub ?\/? ?sub|\bbus\b|큐|메시지/],
    ['lambda', /lambda|serverless|\bfunctions?\b|함수/],
    ['cache', /cache|redis|memcache|valkey|캐시/],
    ['bucket', /storage|bucket|\bs3\b|\bblob|object store|\bcdn\b|\bfiles?\b|저장소|스토리지|파일/],
    ['db', /database|\bdb\b|postgres|mysql|mariadb|mongo|sqlite|dynamo|cassandra|\bsql\b|데이터베이스|디비/],
    ['chip', /\bai\b|\bml\b|\bgpu\b|\bllm\b|model|inference|\bocr\b|추론|모델/],
    ['doc', /report|polic|\brules?\b|contract|\bdocs?\b|document|config|보고서|정책|문서|설정/],
    ['clock', /cron|batch|schedul|worker|\bjobs?\b|\bpoll|배치|워커|스케줄/],
    ['cloud', /cloud|\baws\b|\bgcp\b|azure|external|third[- ]party|\bsaas\b|외부|클라우드/],
    ['browser', /\bweb|browser|frontend|front-end|\bspa\b|react|\bvue\b|website|\bsite\b|웹|브라우저|화면/],
    ['server', /./]
  ];
  function iconOf(n, rules) {
    n = n || {};
    if (n.icon) return n.icon;
    var s = [n.id, n.label].concat(n.tech || []).filter(function (v) { return v != null; }).join(' ').toLowerCase();
    if (n.kind === 'ext') return 'cloud';
    var R = rules || ICON_RULES;
    for (var i = 0; i < R.length; i++) if (R[i] && R[i][1] && R[i][1].test(s)) return R[i][0];
    return 'server';
  }

  // Built-in palettes (rgb() strings: the color math below parses rgb()/rgba() only).
  //   c3..c8 are the categorical colors used for layers and flow kinds.
  var LIGHT = {
    bg: 'rgb(255, 255, 255)', panel: 'rgb(243, 245, 247)', line: 'rgb(208, 215, 222)', fg: 'rgb(31, 35, 40)',
    muted: 'rgb(101, 109, 118)', faint: 'rgb(140, 149, 159)', accent: 'rgb(26, 127, 55)', warm: 'rgb(188, 76, 0)',
    c3: 'rgb(5, 80, 174)', c4: 'rgb(130, 80, 223)', c5: 'rgb(154, 103, 0)', c6: 'rgb(191, 57, 137)', c8: 'rgb(87, 96, 106)'
  };
  var DARK = {
    bg: 'rgb(13, 17, 23)', panel: 'rgb(22, 27, 34)', line: 'rgb(48, 54, 61)', fg: 'rgb(230, 237, 243)',
    muted: 'rgb(141, 150, 160)', faint: 'rgb(110, 118, 129)', accent: 'rgb(63, 185, 80)', warm: 'rgb(240, 136, 62)',
    c3: 'rgb(121, 192, 255)', c4: 'rgb(210, 168, 255)', c5: 'rgb(227, 179, 65)', c6: 'rgb(247, 120, 186)', c8: 'rgb(141, 150, 160)'
  };
  var KEYS = ['bg', 'panel', 'line', 'fg', 'muted', 'faint', 'accent', 'warm', 'c3', 'c4', 'c5', 'c6', 'c8'];
  var FLOW_KINDS = ['req', 'res', 'stream', 'signal', 'p2p', 'block', 'alert', 'deploy'];

  //════════════ validate (pure) ════════════
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function arr(v) { return Array.isArray(v) ? v : []; }
  function isPair(p) { return Array.isArray(p) && isNum(p[0]) && isNum(p[1]); }
  function isPts(p) { return Array.isArray(p) && p.length >= 3 && p.every(isPair); }
  function validate(A) {
    var out = [];
    if (!A || typeof A !== 'object') return ['data must be an object'];
    if (A.style != null && A.style !== 'iso') out.push('style: only "iso" is supported (got ' + JSON.stringify(A.style) + ')');
    var layerSet = Object.create(null), hasLayers = Array.isArray(A.layers) && A.layers.length > 0;
    if (A.layers != null && !Array.isArray(A.layers)) out.push('layers must be an array');
    (Array.isArray(A.layers) ? A.layers : []).forEach(function (l, i) {
      if (!l || l.id == null) { out.push('layers[' + i + ']: missing id'); return; }
      if (layerSet[l.id]) out.push('layers[' + i + ']: duplicate layer id "' + l.id + '"');
      layerSet[l.id] = 1;
    });
    var ids = Object.create(null);
    if (!Array.isArray(A.nodes)) out.push('nodes must be an array');
    (Array.isArray(A.nodes) ? A.nodes : []).forEach(function (n, i) {
      var at = 'nodes[' + i + ']';
      if (!n || typeof n !== 'object') { out.push(at + ': not an object'); return; }
      if (n.id == null || n.id === '') { out.push(at + ': missing id'); return; }
      at += ' "' + n.id + '"';
      if (ids[n.id]) out.push(at + ': duplicate node id');
      ids[n.id] = 1;
      if (!isNum(n.x) || !isNum(n.y)) out.push(at + ': x and y must be numbers (grid units)');
      if (n.label == null) out.push(at + ': missing label');
      if (n.s != null && !(isNum(n.s) && n.s > 0)) out.push(at + ': s must be a positive number');
      if (n.stack != null && !(isNum(n.stack) && n.stack >= 1)) out.push(at + ': stack must be a number >= 1');
      if (n.icon != null && ICONS.indexOf(n.icon) < 0) out.push(at + ': unknown icon "' + n.icon + '" (drawn as a plain square)');
      if (n.layer != null && hasLayers && !layerSet[n.layer]) out.push(at + ': unknown layer "' + n.layer + '"');
      if (n.tech != null && !Array.isArray(n.tech)) out.push(at + ': tech must be an array of strings');
    });
    if (A.edges != null && !Array.isArray(A.edges)) out.push('edges must be an array');
    (Array.isArray(A.edges) ? A.edges : []).forEach(function (e, i) {
      var at = 'edges[' + i + ']';
      if (!Array.isArray(e) || e.length < 2) { out.push(at + ': must be [fromId, toId, kind?]'); return; }
      if (!ids[e[0]]) out.push(at + ': unknown node id "' + e[0] + '"');
      if (!ids[e[1]]) out.push(at + ': unknown node id "' + e[1] + '"');
      if (e[0] === e[1]) out.push(at + ': edge from a node to itself');
    });
    var zoneIds = Object.create(null);
    if (A.zones != null && !Array.isArray(A.zones)) out.push('zones must be an array');
    (Array.isArray(A.zones) ? A.zones : []).forEach(function (z, i) {
      var at = 'zones[' + i + ']' + (z && z.id != null ? ' "' + z.id + '"' : '');
      if (!z || typeof z !== 'object') { out.push(at + ': not an object'); return; }
      if (z.id != null) { if (zoneIds[z.id]) out.push(at + ': duplicate zone id'); zoneIds[z.id] = 1; }
      if (z.pts != null) {
        if (!isPts(z.pts)) out.push(at + ': pts must be at least 3 [x, y] number pairs');
      } else if (!isNum(z.x) || !isNum(z.y) || !isNum(z.w) || !isNum(z.h)) out.push(at + ': needs x, y, w, h numbers (or pts)');
      if (z.flag != null && !isPair(z.flag)) out.push(at + ': flag must be [x, y]');
      if (z.layer != null && hasLayers && !layerSet[z.layer]) out.push(at + ': unknown layer "' + z.layer + '"');
    });
    var scnIds = Object.create(null);
    if (A.scenarios != null && !Array.isArray(A.scenarios)) out.push('scenarios must be an array');
    (Array.isArray(A.scenarios) ? A.scenarios : []).forEach(function (s, i) {
      var at = 'scenarios[' + i + ']' + (s && s.id != null ? ' "' + s.id + '"' : '');
      if (!s || typeof s !== 'object') { out.push(at + ': not an object'); return; }
      if (s.id == null) out.push(at + ': missing id');
      else { if (scnIds[s.id]) out.push(at + ': duplicate scenario id'); scnIds[s.id] = 1; }
      if (!Array.isArray(s.flows)) { out.push(at + ': flows must be an array'); return; }
      s.flows.forEach(function (f, j) {
        var fa = at + '.flows[' + j + ']';
        if (!f || !Array.isArray(f.path) || f.path.length < 2) { out.push(fa + ': path must list at least 2 node ids'); return; }
        f.path.forEach(function (id) { if (!ids[id]) out.push(fa + ': unknown node id "' + id + '"'); });
        if (f.kind != null && FLOW_KINDS.indexOf(f.kind) < 0) out.push(fa + ': unknown kind "' + f.kind + '" (drawn in the accent color)');
        if (f.every != null && !(isNum(f.every) && f.every > 0)) out.push(fa + ': every must be a positive number (ms)');
        if (f.delay != null && !isNum(f.delay)) out.push(fa + ': delay must be a number (ms)');
      });
    });
    // A huge coordinate span does not fit one canvas: create() then scales the drawing down (LIMITS).
    var b = { s0: Infinity, s1: -Infinity, t0: Infinity, t1: -Infinity, x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
    function ext(x, y) {
      if (!isNum(x) || !isNum(y)) return;
      var s = (x - y) * ISO_CX, t = (x + y) * ISO_SY;
      b.s0 = Math.min(b.s0, s); b.s1 = Math.max(b.s1, s); b.t0 = Math.min(b.t0, t); b.t1 = Math.max(b.t1, t);
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    arr(A.nodes).forEach(function (n) {
      if (n && typeof n === 'object') { ext(n.x - 0.5, n.y - 0.5); ext(n.x + 0.5, n.y + 0.5); ext(n.x + 0.5, n.y - 0.5); ext(n.x - 0.5, n.y + 0.5); }
    });
    arr(A.zones).forEach(function (z) {
      if (!z || typeof z !== 'object') return;
      if (isPts(z.pts)) z.pts.forEach(function (p) { ext(p[0], p[1]); });
      else { ext(z.x, z.y); ext(z.x + z.w, z.y + z.h); ext(z.x + z.w, z.y); ext(z.x, z.y + z.h); }
    });
    if (b.s1 >= b.s0 && fitCanvas(b.s1 - b.s0, b.t1 - b.t0, LIMITS.maxSide, 1).scaled) {
      out.push('coordinates span ' + Math.round(b.x1 - b.x0) + ' x ' + Math.round(b.y1 - b.y0) + ' grid units: too big for one canvas (' +
        LIMITS.maxSide + ' px per side), so the drawing is scaled down and labels may overlap');
    }
    return out;
  }

  //════════════ create (needs a DOM) ════════════
  function create(host, A, opts) {
    if (!root || typeof document === 'undefined') throw new Error('VanillaArch.create needs a browser DOM');
    if (!host || !host.appendChild) throw new Error('VanillaArch.create: host element is required');
    A = A || {};
    opts = opts || {};
    var PREFIX = opts.tokenPrefix === undefined ? '--va-' : opts.tokenPrefix;
    var RULES = Array.isArray(opts.iconRules) ? opts.iconRules : ICON_RULES;

    var byId = Object.create(null), NODES = [], edges = [], C = {}, FONT = DEFAULT_FONT;
    var W = 0, H = 0, dpr = 1;
    var hover = null, selected = null, scn = null, sflows = [], flows = [], packets = [], bursts = [];
    var raf = 0, last = 0, visible = true, destroyed = false, tip = null;

    // Sanitized copies: create() draws what it can and skips the rest (validate() explains what was skipped).
    // Nodes need an id (first one wins); x / y / s / stack fall back to safe values; label defaults to the id.
    arr(A.nodes).forEach(function (n) {
      if (!n || typeof n !== 'object' || n.id == null || byId[n.id]) return;
      var d = {}; for (var k in n) if (Object.prototype.hasOwnProperty.call(n, k)) d[k] = n[k];
      d.x = isNum(+n.x) ? +n.x : 0; d.y = isNum(+n.y) ? +n.y : 0;
      d.label = n.label == null ? String(n.id) : String(n.label);
      if (n.s != null && !(+n.s > 0)) delete d.s;
      if (n.stack != null) { if (+n.stack >= 1) d.stack = +n.stack; else delete d.stack; }
      byId[d.id] = { d: d, src: n, x: 0, y: 0, w: 0, h: 0, icon: iconOf(n, RULES) };
      NODES.push(d);
    });
    arr(A.edges).forEach(function (e, i) { if (Array.isArray(e) && byId[e[0]] && byId[e[1]]) edges.push({ a: e[0], b: e[1], kind: e[2] || '', i: i }); });
    var ZONES = arr(A.zones).filter(function (z) {
      return z && typeof z === 'object' && (z.pts != null ? isPts(z.pts) : isNum(z.x) && isNum(z.y) && isNum(z.w) && isNum(z.h));
    }).map(function (z) {   // a malformed flag is ignored rather than drawn at NaN
      if (z.flag == null || isPair(z.flag)) return z;
      var c = {}; for (var k in z) if (Object.prototype.hasOwnProperty.call(z, k)) c[k] = z[k];
      delete c.flag; return c;
    });
    // Layers: given, or derived from the layer ids used by nodes and zones (in order of appearance).
    var LAYERS = arr(A.layers).filter(function (l) { return l && l.id != null; });
    if (!LAYERS.length) {
      var seen = Object.create(null);
      NODES.concat(ZONES).forEach(function (o) { if (o.layer != null && !seen[o.layer]) { seen[o.layer] = 1; LAYERS.push({ id: o.layer, label: String(o.layer) }); } });
    }

    var canvas = document.createElement('canvas');
    canvas.className = 'va-canvas';
    canvas.setAttribute('role', 'img');
    var names = LAYERS.map(function (l) { return l.label == null ? String(l.id) : l.label; });
    canvas.setAttribute('aria-label', opts.ariaLabel || ((A.title || 'Architecture diagram') + (names.length ? ' — ' + names.join(' → ') : '')));
    host.appendChild(canvas);
    var ctx = canvas.getContext('2d');

    var addedWrap = !host.classList.contains('va-wrap'), addedIso = !host.classList.contains('is-iso');
    host.classList.add('va-wrap'); host.classList.add('is-iso');
    var reduce = !!opts.still || !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

    //──────────── colors · font ────────────
    var probe = document.createElement('i'); probe.style.display = 'none'; host.appendChild(probe);
    function tok(name) { probe.style.color = 'var(' + name + ')'; return toRgb(getComputedStyle(probe).color); }
    // Any CSS color -> the browser's rgb()/rgba() form (null when the browser rejects it)
    function cssColor(v) {
      probe.style.color = ''; probe.style.color = String(v);
      if (!probe.style.color) return null;
      return toRgb(getComputedStyle(probe).color);
    }
    // The color math below parses rgb()/rgba() only. Newer syntaxes (oklch(), color-mix(), color()) can stay in
    // that form after computing, so they are converted by painting one pixel and reading it back.
    var px = null;
    function toRgb(s) {
      if (/^rgba?\(/.test(s)) return s;
      if (!px) { var cv = document.createElement('canvas'); cv.width = cv.height = 1; px = cv.getContext('2d', { willReadFrequently: true }); }
      px.clearRect(0, 0, 1, 1); px.fillStyle = '#000'; px.fillStyle = s; px.fillRect(0, 0, 1, 1);
      var d = px.getImageData(0, 0, 1, 1).data;
      return d[3] === 255 ? 'rgb(' + d[0] + ', ' + d[1] + ', ' + d[2] + ')' : 'rgba(' + d[0] + ', ' + d[1] + ', ' + d[2] + ', ' + Math.round(d[3] / 255 * 1000) / 1000 + ')';
    }
    function alpha(rgb, a) { var m = /rgba?\(([^)]+)\)/.exec(rgb); if (!m) return rgb; var p = m[1].split(','); return 'rgba(' + p[0] + ',' + p[1] + ',' + p[2] + ',' + a + ')'; }
    function isDark() {
      if (opts.theme === 'dark') return true;
      if (opts.theme === 'light') return false;
      var de = document.documentElement, t = de.getAttribute('data-theme');
      if (t === 'dark') return true;
      if (t === 'light') return false;
      if (de.classList.contains('dark')) return true;
      return !!(root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches);
    }
    function defined(name) { return !!(name && getComputedStyle(probe).getPropertyValue(name).trim()); }
    var UI_VARS = ['bg', 'panel', 'line', 'fg', 'muted'];
    function readTheme() {
      var base = isDark() ? DARK : LIGHT, pal = opts.palette || {};
      KEYS.forEach(function (k) {
        var v = base[k];
        if (PREFIX && defined(PREFIX + k)) v = tok(PREFIX + k);   // page tokens, only when they are really defined
        if (pal[k] != null) v = cssColor(pal[k]) || v;           // opts.palette wins
        C[k] = v;
      });
      themeGen++;   // forces the cached static layer to redraw
      if (opts.font) FONT = opts.font;
      else if (PREFIX && defined(PREFIX + 'mono')) { probe.style.fontFamily = 'var(' + PREFIX + 'mono)'; FONT = getComputedStyle(probe).fontFamily || DEFAULT_FONT; }
      else FONT = DEFAULT_FONT;
      C.kind = { req: C.accent, res: C.c3, stream: C.c3, signal: C.c4, p2p: C.accent, block: C.c6, alert: C.warm, deploy: C.c5 };
      // Layer colors in order (layer names differ per diagram)
      var pal7 = [C.c3, C.c5, C.accent, C.warm, C.c4, C.c8, C.c6];
      C.layer = Object.create(null);
      LAYERS.forEach(function (l, i) { C.layer[l.id] = pal7[i % pal7.length]; });
      // Hand the surface colors to the stylesheet (wrap background, tooltip) so CSS and canvas agree.
      UI_VARS.forEach(function (k) { host.style.setProperty('--va-ui-' + k, C[k]); });
      host.style.setProperty('--va-ui-font', FONT);
    }

    //──────────── edge helpers (stroke · arrow · point along a route) ────────────
    function posAt(r, d) {
      for (var i = 0; i < r.segs.length; i++) {
        if (d <= r.segs[i] || i === r.segs.length - 1) {
          var t = r.segs[i] ? Math.min(1, d / r.segs[i]) : 1, p = r.pts[i], q = r.pts[i + 1];
          return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
        }
        d -= r.segs[i];
      }
      return r.pts[r.pts.length - 1];
    }
    function strokePath(r) {
      ctx.beginPath(); ctx.moveTo(r.pts[0][0], r.pts[0][1]);
      for (var i = 1; i < r.pts.length - 1; i++) ctx.arcTo(r.pts[i][0], r.pts[i][1], r.pts[i + 1][0], r.pts[i + 1][1], 6);
      ctx.lineTo(r.pts[r.pts.length - 1][0], r.pts[r.pts.length - 1][1]);
      ctx.stroke();
    }
    function arrowEnd(r, color, size) {
      var n = r.pts.length, p = r.pts[n - 1], q = r.pts[n - 2], ang = Math.atan2(p[1] - q[1], p[0] - q[0]), s = size || 6;
      ctx.fillStyle = color; ctx.beginPath();
      ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] - s * Math.cos(ang - 0.5), p[1] - s * Math.sin(ang - 0.5));
      ctx.lineTo(p[0] - s * Math.cos(ang + 0.5), p[1] - s * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
    }
    function edgeLane(a, b) { for (var i = 0; i < edges.length; i++) { var e = edges[i]; if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.i; } return 0; }
    function routeFor(a, b) {
      var lane = edgeLane(a, b), fwd = edges.some(function (e) { return e.a === a && e.b === b; });
      if (fwd || !edges.some(function (e) { return e.a === b && e.b === a; })) return isoRoute(a, b, lane);
      var r = isoRoute(b, a, lane);   // the reverse direction reuses the same line, reversed (no second line)
      var pts = r.pts.slice().reverse(), segs = r.segs.slice().reverse();
      return { pts: pts, segs: segs, len: r.len };
    }

    //──────────── scenarios ────────────
    function activeSet() {
      var nodes = Object.create(null), segs = Object.create(null);
      sflows.forEach(function (f) {
        f.path.forEach(function (id, i) { nodes[id] = f.kind; if (i) segs[f.path[i - 1] + '>' + id] = f.kind; });
      });
      return { nodes: nodes, segs: segs };
    }
    function setScenario(id) {
      scn = null;
      arr(A.scenarios).forEach(function (s) { if (s && s.id === id) scn = s; });
      // Flows that name unknown nodes are dropped (validate() reports them)
      sflows = scn && Array.isArray(scn.flows) ? scn.flows.filter(function (f) {
        return f && Array.isArray(f.path) && f.path.length > 0 && f.path.every(function (n) { return byId[n]; });
      }) : [];
      packets = []; bursts = [];
      var now = performance.now();
      flows = sflows.map(function (f) { return { f: f, next: now + (+f.delay || 0) + 150 }; });
      draw(now);
    }
    function spawn(path, kind, then) {
      var segs = [];
      for (var i = 1; i < path.length; i++) { var r = routeFor(path[i - 1], path[i]); segs.push({ c: r, len: r.len }); }
      packets.push({ segs: segs, i: 0, d: 0, kind: kind, then: then, trail: [] });
    }
    function trip(f) {
      var kind = f.kind, path = f.path.slice();
      spawn(path, kind, function () {
        var end = path[path.length - 1];
        if (kind === 'block') { bursts.push({ id: end, t: 0, kind: 'block' }); return; }
        bursts.push({ id: end, t: 0, kind: kind });
        if (f.back) spawn(path.slice().reverse(), kind === 'req' ? 'res' : kind, function () { bursts.push({ id: path[0], t: 0, kind: kind === 'req' ? 'res' : kind }); });
      });
    }

    //──────────── drawing primitives ────────────
    function roundRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }
    function fitText(s, w) {
      if (ctx.measureText(s).width <= w) return s;
      while (s.length > 1 && ctx.measureText(s + '…').width > w) s = s.slice(0, -1);
      return s + '…';
    }

    // ── icons (line drawings; s = side length, centered on cx, cy) ──
    function icon(kind, cx, cy, s, col) {
      var h = s / 2, x = cx - h, y = cy - h;
      ctx.save();
      ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 1.6; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      var circle = function (x0, y0, r, fill) { ctx.beginPath(); ctx.arc(x0, y0, r, 0, Math.PI * 2); if (fill) ctx.fill(); else ctx.stroke(); };
      var cyl = function (top, bot, lines) {
        var rx = h * 0.85, ry = s * 0.13;
        ctx.beginPath(); ctx.ellipse(cx, top, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx - rx, top); ctx.lineTo(cx - rx, bot); ctx.ellipse(cx, bot, rx, ry, 0, Math.PI, 0, true); ctx.lineTo(cx + rx, top); ctx.stroke();
        for (var i = 1; i <= lines; i++) { var yy = top + (bot - top) * i / (lines + 1); ctx.beginPath(); ctx.ellipse(cx, yy, rx, ry, 0, 0, Math.PI); ctx.stroke(); }
      };
      switch (kind) {
        case 'users':
          circle(cx - h * 0.35, y + s * 0.3, s * 0.15); circle(cx + h * 0.4, y + s * 0.34, s * 0.13);
          ctx.beginPath(); ctx.arc(cx - h * 0.35, y + s * 0.92, s * 0.3, Math.PI * 1.08, Math.PI * 1.92); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx + h * 0.42, y + s * 0.9, s * 0.25, Math.PI * 1.12, Math.PI * 1.88); ctx.stroke();
          break;
        case 'person':
          circle(cx, y + s * 0.3, s * 0.17);
          ctx.beginPath(); ctx.arc(cx, y + s * 0.98, s * 0.38, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
          break;
        case 'mobile':
          roundRect(cx - s * 0.24, y + 1, s * 0.48, s - 2, 3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 2, y + s - 4.5); ctx.lineTo(cx + 2, y + s - 4.5); ctx.stroke();
          break;
        case 'browser':
          roundRect(x + 1, y + 3, s - 2, s - 6, 3); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 1, y + 8.5); ctx.lineTo(x + s - 1, y + 8.5); ctx.stroke();
          circle(x + 4.5, y + 5.8, 0.9, true); circle(x + 7.5, y + 5.8, 0.9, true);
          break;
        case 'server':
          [0, 1, 2].forEach(function (i) { var yy = y + 2 + i * (s - 4) / 3; roundRect(x + 2, yy, s - 4, (s - 4) / 3 - 1.5, 2); ctx.stroke(); circle(x + s - 6, yy + ((s - 4) / 3 - 1.5) / 2, 1, true); });
          break;
        case 'db': cyl(y + s * 0.18, y + s * 0.82, 2); break;
        case 'cache':
          cyl(y + s * 0.18, y + s * 0.82, 0);
          ctx.beginPath(); ctx.moveTo(cx + 1.5, y + s * 0.34); ctx.lineTo(cx - 3, y + s * 0.56); ctx.lineTo(cx + 1, y + s * 0.56); ctx.lineTo(cx - 1.5, y + s * 0.76); ctx.stroke();
          break;
        case 'bucket':
          ctx.beginPath(); ctx.ellipse(cx, y + s * 0.22, h * 0.85, s * 0.12, 0, 0, Math.PI * 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - h * 0.85, y + s * 0.22); ctx.lineTo(cx - h * 0.6, y + s * 0.85); ctx.lineTo(cx + h * 0.6, y + s * 0.85); ctx.lineTo(cx + h * 0.85, y + s * 0.22); ctx.stroke();
          break;
        case 'queue':
          [0, 1, 2].forEach(function (i) { roundRect(x + 2 + i * (s - 4) / 3, y + s * 0.3, (s - 4) / 3 - 2, s * 0.4, 1.5); ctx.stroke(); });
          break;
        case 'lambda':
          roundRect(x + 1, y + 1, s - 2, s - 2, 4); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + s * 0.3, y + s * 0.25); ctx.lineTo(x + s * 0.42, y + s * 0.25); ctx.lineTo(x + s * 0.72, y + s * 0.78); ctx.moveTo(x + s * 0.52, y + s * 0.44); ctx.lineTo(x + s * 0.3, y + s * 0.78); ctx.stroke();
          break;
        case 'cloud':
          ctx.beginPath();
          ctx.moveTo(x + s * 0.25, y + s * 0.75);
          ctx.arc(x + s * 0.27, y + s * 0.58, s * 0.17, Math.PI * 0.5, Math.PI * 1.45);
          ctx.arc(x + s * 0.5, y + s * 0.4, s * 0.22, Math.PI * 1.1, Math.PI * 1.95);
          ctx.arc(x + s * 0.74, y + s * 0.58, s * 0.17, Math.PI * 1.5, Math.PI * 0.5);
          ctx.closePath(); ctx.stroke();
          break;
        case 'shield':
          ctx.beginPath(); ctx.moveTo(cx, y + 1); ctx.lineTo(x + s - 3, y + s * 0.2); ctx.lineTo(x + s - 4, y + s * 0.55); ctx.quadraticCurveTo(cx + s * 0.2, y + s * 0.88, cx, y + s - 1);
          ctx.quadraticCurveTo(cx - s * 0.2, y + s * 0.88, x + 4, y + s * 0.55); ctx.lineTo(x + 3, y + s * 0.2); ctx.closePath(); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(cx - 3.5, cy); ctx.lineTo(cx - 0.5, cy + 3); ctx.lineTo(cx + 4, cy - 3); ctx.stroke();
          break;
        case 'bolt':
          ctx.beginPath(); ctx.moveTo(cx + 2, y + 1); ctx.lineTo(cx - 5, cy + 1); ctx.lineTo(cx, cy + 1); ctx.lineTo(cx - 2, y + s - 1); ctx.lineTo(cx + 5, cy - 1); ctx.lineTo(cx, cy - 1); ctx.closePath(); ctx.stroke();
          break;
        case 'chip':
          roundRect(x + 5, y + 5, s - 10, s - 10, 2); ctx.stroke();
          for (var i = 0; i < 3; i++) {
            var t = x + 8 + i * (s - 16) / 2;
            ctx.beginPath(); ctx.moveTo(t, y + 1); ctx.lineTo(t, y + 5); ctx.moveTo(t, y + s - 5); ctx.lineTo(t, y + s - 1);
            ctx.moveTo(x + 1, t - x + y); ctx.lineTo(x + 5, t - x + y); ctx.moveTo(x + s - 5, t - x + y); ctx.lineTo(x + s - 1, t - x + y); ctx.stroke();
          }
          break;
        case 'doc':
          ctx.beginPath(); ctx.moveTo(x + 4, y + 1); ctx.lineTo(x + s - 9, y + 1); ctx.lineTo(x + s - 4, y + 6); ctx.lineTo(x + s - 4, y + s - 1); ctx.lineTo(x + 4, y + s - 1); ctx.closePath(); ctx.stroke();
          [0.42, 0.6, 0.78].forEach(function (k) { ctx.beginPath(); ctx.moveTo(x + 8, y + s * k); ctx.lineTo(x + s - 8, y + s * k); ctx.stroke(); });
          break;
        case 'clock':
          circle(cx, cy, h - 1.5);
          ctx.beginPath(); ctx.moveTo(cx, cy - h * 0.55); ctx.lineTo(cx, cy); ctx.lineTo(cx + h * 0.4, cy + h * 0.25); ctx.stroke();
          break;
        case 'chart':
          ctx.beginPath(); ctx.moveTo(x + 2, y + 2); ctx.lineTo(x + 2, y + s - 2); ctx.lineTo(x + s - 1, y + s - 2); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x + 5, y + s * 0.7); ctx.lineTo(x + s * 0.42, y + s * 0.42); ctx.lineTo(x + s * 0.62, y + s * 0.58); ctx.lineTo(x + s - 2, y + s * 0.22); ctx.stroke();
          break;
        case 'bell':
          ctx.beginPath(); ctx.moveTo(x + 4, y + s * 0.72); ctx.quadraticCurveTo(x + 6, y + s * 0.62, x + 6, y + s * 0.42); ctx.arc(cx, y + s * 0.42, h - 6, Math.PI, 0); ctx.quadraticCurveTo(x + s - 6, y + s * 0.62, x + s - 4, y + s * 0.72); ctx.closePath(); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, y + s * 0.8, 2.2, 0, Math.PI); ctx.stroke();
          break;
        case 'lock':
          roundRect(x + 4, y + s * 0.45, s - 8, s * 0.48, 2); ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, y + s * 0.45, h * 0.5, Math.PI, 0); ctx.stroke();
          break;
        case 'git':
          circle(x + 6, y + 5, 2.4); circle(x + 6, y + s - 5, 2.4); circle(x + s - 6, cy - 2, 2.4);
          ctx.beginPath(); ctx.moveTo(x + 6, y + 7.5); ctx.lineTo(x + 6, y + s - 7.5); ctx.moveTo(x + s - 6, cy + 0.5); ctx.quadraticCurveTo(x + s - 6, y + s - 6, x + 8.5, y + s - 5); ctx.stroke();
          break;
        default:
          roundRect(x + 2, y + 2, s - 4, s - 4, 4); ctx.stroke();
      }
      ctx.restore();
    }
    function related(id) {
      var set = Object.create(null); set[id] = 1;
      edges.forEach(function (e) { if (e.a === id) set[e.b] = 1; if (e.b === id) set[e.a] = 1; });
      return set;
    }

    //════════════ isometric projection ════════════
    // Grid (x, y, z) -> screen. x runs to the lower right, y to the lower left, z up (one cell = U px).
    var ISO = { cx: ISO_CX, sy: ISO_SY, padT: FIT.padT, foot: 0.85, slab: 0.22, gap: 0.07,
      dimBlock: 0.62, dimLabel: 0.72 };   // blocks outside the scenario stay readable (only flow members are full strength)
    var U = 32, ox = 0, oy = 0, CW = 0;
    function P(x, y, z) { return [ox + (x - y) * ISO.cx * U, oy + (x + y) * ISO.sy * U - (z || 0) * U]; }

    // color mixing (colors are rgb(...) strings)
    function rgbOf(s) { var m = /rgba?\(([^)]+)\)/.exec(s); if (!m) return [128, 128, 128]; var p = m[1].split(','); return [+p[0], +p[1], +p[2]]; }
    function mix(a, b, t) {
      var p = rgbOf(a), q = rgbOf(b);
      return 'rgb(' + Math.round(p[0] + (q[0] - p[0]) * t) + ',' + Math.round(p[1] + (q[1] - p[1]) * t) + ',' + Math.round(p[2] + (q[2] - p[2]) * t) + ')';
    }
    function lum(s) { var p = rgbOf(s); return (0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]) / 255; }

    // Block shape follows the icon: db / cache -> cylinder, users / person -> figure, everything else -> box
    function shapeOf(b) { var k = b.icon; return k === 'db' || k === 'cache' ? 'cyl' : k === 'users' || k === 'person' ? 'figure' : 'box'; }
    function isoDims(b) {
      var n = b.d, sh = shapeOf(b), st = Math.max(1, n.stack || 1), h;
      if (st > 1) h = st * ISO.slab + (st - 1) * ISO.gap;
      else h = sh === 'cyl' ? 0.62 : sh === 'figure' ? 0.07 : n.kind === 'ext' ? 0.34 : 0.48;
      return { hs: (n.s || ISO.foot) * 0.5, h: h, top: sh === 'figure' ? 0.95 : h, sh: sh, st: st };
    }

    // Inner width of the host. clientWidth is rounded, so on fractional layouts (zoom, odd DPR) it can be up to 1px
    // wider than the real box, which would add a needless horizontal scrollbar; trim that sub-pixel excess.
    function hostWidth() {
      var cw = host.clientWidth, cs = getComputedStyle(host);
      var r = host.getBoundingClientRect().width - (parseFloat(cs.borderLeftWidth) || 0) - (parseFloat(cs.borderRightWidth) || 0);
      return r > 0 && r < cw && cw - r < 1 ? Math.min(cw, r + 0.05) : cw;   // + 0.05 absorbs float noise (619.999 -> 620)
    }
    function isoLayout() {
      W = Math.max(280, Math.floor(hostWidth()));   // wider drawings scroll sideways inside the host
      NODES.forEach(function (n) { byId[n.id].dm = isoDims(byId[n.id]); });
      // extent of the drawing in grid terms (horizontal s = x - y, vertical t = x + y - height)
      var s0 = 1e9, s1 = -1e9, t0 = 1e9, t1 = -1e9;
      function acc(x, y, z) {
        var s = (x - y) * ISO.cx, t = (x + y) * ISO.sy - (z || 0);
        if (s < s0) s0 = s; if (s > s1) s1 = s; if (t < t0) t0 = t; if (t > t1) t1 = t;
      }
      ZONES.forEach(function (z) { zonePts(z).forEach(function (q) { acc(q[0], q[1]); }); });
      NODES.forEach(function (n) {
        var m = byId[n.id].dm;
        acc(n.x - m.hs, n.y - m.hs, m.top); acc(n.x + m.hs, n.y + m.hs); acc(n.x + m.hs, n.y - m.hs); acc(n.x - m.hs, n.y + m.hs);
      });
      if (s1 < s0) { s0 = s1 = t0 = t1 = 0; }   // empty diagram
      if (!isFinite(s0) || !isFinite(s1) || !isFinite(t0) || !isFinite(t1)) { s0 = s1 = t0 = t1 = 0; }
      var spanW = s1 - s0, spanH = t1 - t0;
      // cell size: fit the host width but keep labels readable (if it still does not fit, the host scrolls);
      // a drawing too big for one canvas is scaled down instead (LIMITS)
      var fit = fitCanvas(spanW, spanH, W, opts.dpr || Math.min(2, root.devicePixelRatio || 1));
      U = fit.U; CW = fit.CW; H = fit.H;
      ox = (CW - spanW * U) / 2 - s0 * U; oy = ISO.padT - t0 * U;
      NODES.forEach(function (n) { var b = byId[n.id], p = P(n.x, n.y, 0); b.x = p[0]; b.y = p[1]; });
      dpr = fit.dpr;
      canvas.width = Math.round(CW * dpr); canvas.height = Math.round(H * dpr);
      canvas.style.width = CW + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    // Edges run on the floor along grid directions only (one bend), from block edge to block edge.
    // Of the two candidates (x first / y first) take the one that passes under fewer other blocks.
    function legHits(p, q, skipA, skipB) {
      var n = 0, x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]), y0 = Math.min(p[1], q[1]), y1 = Math.max(p[1], q[1]);
      NODES.forEach(function (o) {
        if (o.id === skipA || o.id === skipB) return;
        var r = byId[o.id].dm.hs + 0.08;
        if (o.x + r > x0 && o.x - r < x1 && o.y + r > y0 && o.y - r < y1) n++;
      });
      return n;
    }
    function isoRoute(aId, bId, lane) {
      var a = byId[aId].d, b = byId[bId].d, ma = byId[aId].dm, mb = byId[bId].dm;
      var o = (((lane || 0) % 5) - 2) * 0.07, dx = b.x - a.x, dy = b.y - a.y, sx = dx >= 0 ? 1 : -1, sy = dy >= 0 ? 1 : -1, g;
      if (Math.abs(dy) < mb.hs) g = [[a.x + sx * (ma.hs + 0.06), a.y + o], [b.x - sx * (mb.hs + 0.1), a.y + o]];
      else if (Math.abs(dx) < mb.hs) g = [[a.x + o, a.y + sy * (ma.hs + 0.06)], [a.x + o, b.y - sy * (mb.hs + 0.1)]];
      else {
        var gx = [[a.x + sx * (ma.hs + 0.06), a.y + o], [b.x + o, a.y + o], [b.x + o, b.y - sy * (mb.hs + 0.1)]];
        var gy = [[a.x + o, a.y + sy * (ma.hs + 0.06)], [a.x + o, b.y + o], [b.x - sx * (mb.hs + 0.1), b.y + o]];
        var hx = legHits(gx[0], gx[1], aId, bId) + legHits(gx[1], gx[2], aId, bId), hy = legHits(gy[0], gy[1], aId, bId) + legHits(gy[1], gy[2], aId, bId);
        g = hy < hx ? gy : gx;
      }
      var pts = g.map(function (q) { return P(q[0], q[1], 0); }), segs = [], len = 0;
      for (var i = 1; i < pts.length; i++) { var l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); segs.push(l); len += l; }
      return { pts: pts, segs: segs, len: len };
    }

    // Zone corners (grid): rectangle x · y · w · h, or polygon pts
    function zonePts(z) { return z.pts || [[z.x, z.y], [z.x + z.w, z.y], [z.x + z.w, z.y + z.h], [z.x, z.y + z.h]]; }
    function poly(q) { ctx.beginPath(); ctx.moveTo(q[0][0], q[0][1]); for (var i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]); ctx.closePath(); }
    function footprint(n, hs, z) { return [P(n.x - hs, n.y - hs, z), P(n.x + hs, n.y - hs, z), P(n.x + hs, n.y + hs, z), P(n.x - hs, n.y + hs, z)]; }
    function depthOrder() { return NODES.slice().sort(function (p, q) { return (p.x + p.y) - (q.x + q.y) || p.x - q.x; }); }

    // Top-face icon: seen from above (width kept, height squashed)
    function decal(kind, x, y, z, size, col) {
      var p = P(x, y, z), k = size * U / ICON;
      ctx.save();
      ctx.transform(k * Math.SQRT2 * ISO.cx, 0, 0, k * Math.SQRT2 * ISO.sy, p[0], p[1]);
      icon(kind, 0, 0, ICON, col);
      ctx.restore();
    }
    // Standing person (feet at px, py; height s px)
    function person(px, py, s, f1, f2, line) {
      var g = ctx.createLinearGradient(px - s * 0.3, 0, px + s * 0.3, 0); g.addColorStop(0, f1); g.addColorStop(1, f2);
      ctx.beginPath();
      ctx.moveTo(px - s * 0.27, py); ctx.lineTo(px - s * 0.27, py - s * 0.4);
      ctx.quadraticCurveTo(px - s * 0.27, py - s * 0.62, px, py - s * 0.62);
      ctx.quadraticCurveTo(px + s * 0.27, py - s * 0.62, px + s * 0.27, py - s * 0.4);
      ctx.lineTo(px + s * 0.27, py); ctx.closePath();
      ctx.fillStyle = g; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py - s * 0.8, s * 0.16, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill(); ctx.stroke();
    }

    function drawBlock(n, act, rel, dark) {
      var b = byId[n.id], m = b.dm, on = act.nodes[n.id];
      var dim = (scn && !on && !(rel && rel[n.id])) || (rel && !rel[n.id] && !on);
      var col = n.kind === 'bad' ? C.c6 : (C.layer[n.layer] || C.accent), up = on ? 0.12 : 0;
      // light from above: top face brightest, right face darkest (both themes)
      var fTop = dark ? mix(C.bg, col, 0.40 + up) : mix(C.bg, col, 0.14 + up);
      var fL = dark ? mix(C.bg, col, 0.25 + up) : mix(C.bg, col, 0.30 + up);
      var fR = dark ? mix(C.bg, col, 0.15 + up) : mix(C.bg, col, 0.44 + up);
      var line = n.id === selected ? C.accent : n.id === hover ? C.fg : alpha(col, dark ? 0.85 : 0.7);
      var lw = n.id === selected ? 2 : n.id === hover ? 1.5 : 1;
      ctx.globalAlpha = dim ? ISO.dimBlock : 1;
      ctx.lineJoin = 'round';
      // shadow on the floor, slightly to the lower right
      poly([P(n.x - m.hs + 0.16, n.y - m.hs + 0.16), P(n.x + m.hs + 0.2, n.y - m.hs + 0.16), P(n.x + m.hs + 0.2, n.y + m.hs + 0.2), P(n.x - m.hs + 0.16, n.y + m.hs + 0.2)]);
      ctx.fillStyle = dark ? 'rgba(0,0,0,0.35)' : 'rgba(31,35,40,0.08)'; ctx.fill();
      // selected: dashed outline on the floor
      if (n.id === selected) { poly(footprint(n, m.hs + 0.18, 0)); ctx.strokeStyle = alpha(C.accent, 0.8); ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]); ctx.stroke(); ctx.setLineDash([]); }

      function box(z0, h, hs) {
        var x = n.x, y = n.y;
        var a = P(x - hs, y + hs, z0), bb = P(x + hs, y + hs, z0), c = P(x + hs, y - hs, z0);
        var a2 = P(x - hs, y + hs, z0 + h), b2 = P(x + hs, y + hs, z0 + h), c2 = P(x + hs, y - hs, z0 + h), d2 = P(x - hs, y - hs, z0 + h);
        ctx.lineWidth = lw; ctx.strokeStyle = line;
        if (n.kind === 'ext') ctx.setLineDash([3, 3]);
        poly([a, bb, b2, a2]); ctx.fillStyle = fL; ctx.fill(); ctx.stroke();
        poly([bb, c, c2, b2]); ctx.fillStyle = fR; ctx.fill(); ctx.stroke();
        poly([d2, a2, b2, c2]); ctx.fillStyle = fTop; ctx.fill(); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (m.sh === 'cyl') {
        var c0 = P(n.x, n.y, 0), c1 = P(n.x, n.y, m.h), rx = m.hs * U * Math.SQRT2 * ISO.cx * 0.9, ry = m.hs * U * Math.SQRT2 * ISO.sy * 0.9;
        var g = ctx.createLinearGradient(c0[0] - rx, 0, c0[0] + rx, 0); g.addColorStop(0, fL); g.addColorStop(1, fR);
        ctx.lineWidth = lw; ctx.strokeStyle = line;
        ctx.beginPath(); ctx.moveTo(c1[0] - rx, c1[1]); ctx.lineTo(c0[0] - rx, c0[1]); ctx.ellipse(c0[0], c0[1], rx, ry, 0, Math.PI, 0, true); ctx.lineTo(c1[0] + rx, c1[1]); ctx.closePath();
        ctx.fillStyle = g; ctx.fill(); ctx.stroke();
        ctx.strokeStyle = alpha(col, 0.45); ctx.lineWidth = 1;   // platter lines
        [1, 2].forEach(function (k) { var yy = c0[1] - m.h * U * k / 3; ctx.beginPath(); ctx.ellipse(c0[0], yy, rx, ry, 0, 0, Math.PI); ctx.stroke(); });
        ctx.beginPath(); ctx.ellipse(c1[0], c1[1], rx, ry, 0, 0, Math.PI * 2); ctx.fillStyle = fTop; ctx.fill(); ctx.strokeStyle = line; ctx.lineWidth = lw; ctx.stroke();
        decal(b.icon, n.x, n.y, m.h, m.hs * 0.95, col);
      } else if (m.sh === 'figure') {
        // low plinth + standing figure (two for 'users')
        box(0, m.h, m.hs * 0.9);
        var f = P(n.x, n.y, m.h), s = U * 0.78;
        if (b.icon === 'users') { person(f[0] - s * 0.24, f[1] - 1, s * 0.86, fL, fR, line); person(f[0] + s * 0.22, f[1] + 2, s, fTop, fR, line); }
        else person(f[0], f[1], s, fTop, fR, line);
      } else {
        for (var i = 0; i < m.st; i++) {
          var z0 = i * (ISO.slab + ISO.gap), h = m.st > 1 ? ISO.slab : m.h;
          box(z0, h, m.hs);
          if (m.st > 1) {   // status lights on the front of each stacked unit
            ctx.fillStyle = alpha(col, 0.9);
            [0.25, 0.4].forEach(function (k) { var d = P(n.x - m.hs + k, n.y + m.hs, z0 + h / 2); ctx.beginPath(); ctx.arc(d[0], d[1], 1.4, 0, Math.PI * 2); ctx.fill(); });
          }
        }
        decal(b.icon, n.x, n.y, m.h, m.hs * 1.05, col);
      }
      ctx.globalAlpha = 1;
    }

    // Label under the block's bottom corner, with a background-colored halo so it reads over lines.
    // Long labels wrap at spaces (three lines max).
    function isoLabel(s, cx, y, maxW) {
      ctx.font = '10.5px ' + FONT;
      var lines = [], cur = '';
      s.split(' ').forEach(function (w) {
        var t = cur ? cur + ' ' + w : w;
        if (cur && ctx.measureText(t).width > maxW) { lines.push(cur); cur = w; } else cur = t;
      });
      if (cur) lines.push(cur);
      // a line that starts with '·' or ':' hands that mark back to the previous line
      lines = lines.reduce(function (a, t) {
        var m = /^([·:])\s*(.*)$/.exec(t);
        if (a.length && m) { a[a.length - 1] += ' ' + m[1]; if (m[2]) a.push(m[2]); } else a.push(t);
        return a;
      }, []);
      if (lines.length > 3) { lines = lines.slice(0, 3); lines[2] += '…'; }
      lines = lines.map(function (t) { return fitText(t, maxW + 8); });
      ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = C.bg;
      lines.forEach(function (t, k) { ctx.strokeText(t, cx, y + k * 12.5); ctx.fillText(t, cx, y + k * 12.5); });
    }

    // The static layer (grid · zones · edges · blocks · flags · labels) is drawn once into an offscreen canvas;
    // each frame blits it and draws only packets and arrival marks on top. It is redrawn only when size, theme,
    // hover, selection or scenario change.
    var still = null, stillCtx = null, stillKey = '', themeGen = 0;
    function isoDraw(now) {
      if (opts.still) { isoStatic(); isoMoving(); return; }   // one-off still image: draw directly
      var key = [scn ? scn.id : '', hover, selected, canvas.width, canvas.height, U, ox, oy, themeGen].join('|');
      if (!still || key !== stillKey) {
        if (!still) {
          // kept (hidden) in the document so font fallback matches the visible canvas (it inherits lang)
          still = document.createElement('canvas'); still.style.display = 'none'; still.setAttribute('aria-hidden', 'true');
          host.appendChild(still); stillCtx = still.getContext('2d');
        }
        if (still.width !== canvas.width || still.height !== canvas.height) { still.width = canvas.width; still.height = canvas.height; }
        var main = ctx; ctx = stillCtx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        try { isoStatic(); } finally { ctx = main; }
        stillKey = key;
      }
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(still, 0, 0);
      ctx.restore();
      isoMoving();
    }
    function isoStatic() {
      ctx.clearRect(0, 0, CW, H);
      var act = activeSet(), focus = hover || selected, rel = focus ? related(focus) : null, dark = lum(C.bg) < 0.5;
      var Z = ZONES;

      // floor grid (only under the zones)
      if (Z.length) {
        var gx0 = Infinity, gy0 = Infinity, gx1 = -Infinity, gy1 = -Infinity;
        Z.forEach(function (z) { zonePts(z).forEach(function (q) { gx0 = Math.min(gx0, q[0]); gy0 = Math.min(gy0, q[1]); gx1 = Math.max(gx1, q[0]); gy1 = Math.max(gy1, q[1]); }); });
        gx0 = Math.floor(gx0); gy0 = Math.floor(gy0); gx1 = Math.ceil(gx1); gy1 = Math.ceil(gy1);
        ctx.lineWidth = 1; ctx.strokeStyle = alpha(C.line, dark ? 0.28 : 0.32);
        ctx.beginPath();
        for (var gx = gx0; gx <= gx1; gx++) { var p0 = P(gx, gy0), p1 = P(gx, gy1); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); }
        for (var gy = gy0; gy <= gy1; gy++) { var q0 = P(gx0, gy), q1 = P(gx1, gy); ctx.moveTo(q0[0], q0[1]); ctx.lineTo(q1[0], q1[1]); }
        ctx.stroke();
      }
      // zones: plates on the floor
      Z.forEach(function (z) {
        var col = z.layer != null && C.layer[z.layer] ? C.layer[z.layer] : C.c8, group = z.tone === 'group';
        poly(zonePts(z).map(function (q) { return P(q[0], q[1]); }));
        ctx.fillStyle = alpha(col, group ? 0.04 : dark ? 0.1 : 0.07); ctx.fill();
        if (!group) ctx.setLineDash([5, 4]);
        ctx.lineWidth = group ? 1.3 : 1; ctx.strokeStyle = alpha(col, group ? 0.5 : 0.6); ctx.stroke(); ctx.setLineDash([]);
      });

      // edges (on the floor)
      edges.forEach(function (e) {
        var r = isoRoute(e.a, e.b, e.i), k = act.segs[e.a + '>' + e.b] || act.segs[e.b + '>' + e.a];
        var hot = rel && (e.a === focus || e.b === focus);
        var col = k ? alpha(C.kind[k] || C.accent, 0.85) : hot ? alpha(C.fg, 0.65) : alpha(C.muted, scn ? 0.3 : 0.55);
        ctx.lineWidth = k ? 2 : hot ? 1.6 : 1.1; ctx.strokeStyle = col;
        if (e.kind === 'p2p') ctx.setLineDash([5, 4]);
        strokePath(r); ctx.setLineDash([]);
        arrowEnd(r, col, k ? 7 : 5.5);
      });
      sflows.forEach(function (f) {   // scenario hops that are not regular edges (dashed)
        for (var i = 1; i < f.path.length; i++) {
          var a = f.path[i - 1], b = f.path[i];
          if (edges.some(function (e) { return (e.a === a && e.b === b) || (e.a === b && e.b === a); })) continue;
          var r = isoRoute(a, b, i), col = alpha(C.kind[f.kind] || C.accent, 0.7);
          ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.strokeStyle = col; strokePath(r); ctx.setLineDash([]);
          arrowEnd(r, col, 6.5);
        }
      });

      // blocks (back to front)
      var order = depthOrder();
      order.forEach(function (n) { drawBlock(n, act, rel, dark); });

      // Zone names: small flags pinned to a zone corner, placed where they do not cover blocks, labels or other flags
      // (outside the left corner -> outside the right corner -> above the top corner). z.flag forces the spot.
      ctx.font = '600 10px ' + FONT; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      var taken = obstacles();
      Z.forEach(function (z) {
        if (!z.label) return;
        var col = z.layer != null && C.layer[z.layer] ? C.layer[z.layer] : C.c8, tw = ctx.measureText(z.label).width + 12, cands;
        if (z.flag || z.pts) {
          var f = z.flag || z.pts[0], q0 = P(f[0], f[1]);
          cands = [[q0, q0[0] - 6, q0[1] - 15]];
          if (z.pts) {   // polygon: the leftmost and rightmost corners are candidates too
            var sc = z.pts.map(function (v) { return P(v[0], v[1]); });
            var lv = sc.reduce(function (a, v) { return v[0] < a[0] ? v : a; }), rv = sc.reduce(function (a, v) { return v[0] > a[0] ? v : a; });
            cands.push([lv, lv[0] - tw - 4, lv[1] - 7.5], [rv, rv[0] + 4, rv[1] - 7.5]);
          }
        }
        else {
          var L = P(z.x, z.y + z.h), R = P(z.x + z.w, z.y), T = P(z.x, z.y);
          cands = [[L, L[0] - tw - 4, L[1] - 7.5], [R, R[0] + 4, R[1] - 7.5], [T, T[0] - tw / 2, T[1] - 19]];
        }
        cands.forEach(function (c) { c[1] = Math.max(2, Math.min(CW - tw - 2, c[1])); c[2] = Math.max(2, Math.min(H - 17, c[2])); });
        var pick = cands.filter(function (c) { return !taken.some(function (o) { return c[1] < o[2] && o[0] < c[1] + tw && c[2] < o[3] && o[1] < c[2] + 15; }); })[0] || cands[0];
        var p = pick[0], x = pick[1], y = pick[2];
        taken.push([x - 2, y - 2, x + tw + 2, y + 17]);
        roundRect(x, y, tw, 15, 7.5); ctx.fillStyle = mix(C.bg, col, dark ? 0.22 : 0.12); ctx.fill();
        ctx.lineWidth = 1; ctx.strokeStyle = alpha(col, 0.55); ctx.stroke();
        ctx.fillStyle = col; ctx.fillText(z.label, x + 6, y + 8);
        // pin dot (skipped when the flag had to be pushed over it at the canvas edge)
        if (p[0] < x - 1 || p[0] > x + tw + 1 || p[1] < y - 1 || p[1] > y + 16) { ctx.beginPath(); ctx.arc(p[0], p[1], 2, 0, Math.PI * 2); ctx.fill(); }
      });

      // node labels
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      order.forEach(function (n) {
        var b = byId[n.id], m = b.dm, on = act.nodes[n.id];
        var dim = (scn && !on && !(rel && rel[n.id])) || (rel && !rel[n.id] && !on);
        var p = P(n.x + m.hs, n.y + m.hs, 0);
        ctx.globalAlpha = dim ? ISO.dimLabel : 1;
        ctx.fillStyle = n.kind === 'bad' ? C.c6 : n.id === selected ? C.accent : C.fg;
        isoLabel(String(n.short || n.label), p[0], p[1] + 5, Math.max(80, U * 2.6));
        ctx.globalAlpha = 1;
      });
    }
    // Moving layer: packets (above blocks and labels) and arrival marks
    function isoMoving() {
      packets.forEach(function (p) {
        var col = C.kind[p.kind] || C.accent;
        for (var j = 0; j < p.trail.length; j++) {
          var t = p.trail[j], a2 = (j + 1) / (p.trail.length + 1);
          ctx.fillStyle = alpha(col, a2 * 0.45); ctx.beginPath(); ctx.arc(t[0], t[1], 1.4 + a2 * 2, 0, Math.PI * 2); ctx.fill();
        }
        var s = p.segs[p.i]; if (!s) return;
        var pos = posAt(s.c, Math.min(s.len, p.d));
        ctx.fillStyle = alpha(col, 0.22); ctx.beginPath(); ctx.arc(pos[0], pos[1], 7, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = col; ctx.beginPath(); ctx.arc(pos[0], pos[1], 3.6, 0, Math.PI * 2); ctx.fill();
      });
      // arrival: the floor outline spreads out; 'block' adds an x above the block
      bursts.forEach(function (bu) {
        var n = byId[bu.id].d, m = byId[bu.id].dm, k = bu.t / 650, col = C.kind[bu.kind] || C.accent;
        poly(footprint(n, m.hs + 0.1 + 0.45 * k, 0)); ctx.strokeStyle = alpha(col, Math.max(0, 1 - k)); ctx.lineWidth = 2; ctx.stroke();
        if (bu.kind === 'block') {
          var t = P(n.x, n.y, m.top), r = 5;
          ctx.strokeStyle = alpha(C.c6, Math.max(0, 1 - k * 0.6)); ctx.lineWidth = 2.2;
          ctx.beginPath(); ctx.moveTo(t[0] - r, t[1] - 12 - r); ctx.lineTo(t[0] + r, t[1] - 12 + r); ctx.moveTo(t[0] + r, t[1] - 12 - r); ctx.lineTo(t[0] - r, t[1] - 12 + r); ctx.stroke();
        }
      });
    }

    // Areas zone flags must avoid: block outline boxes + the label area under each block ([x0, y0, x1, y1])
    function obstacles() {
      var out = [];
      ctx.save(); ctx.font = '10.5px ' + FONT;
      NODES.forEach(function (n) {
        var m = byId[n.id].dm, hs = m.hs, a = P(n.x - hs, n.y + hs, 0), c = P(n.x + hs, n.y - hs, 0), t = P(n.x - hs, n.y - hs, m.top), b = P(n.x + hs, n.y + hs, 0);
        out.push([a[0], t[1], c[0], b[1]]);
        var lw = ctx.measureText(String(n.short || n.label)).width / 2 + 3;
        out.push([b[0] - lw, b[1] + 3, b[0] + lw, b[1] + 19]);
      });
      ctx.restore();
      return out;
    }

    // Hit test: the block's hexagonal outline, or its label area
    function inPoly(q, x, y) {
      var c = false;
      for (var i = 0, j = q.length - 1; i < q.length; j = i++) {
        if (((q[i][1] > y) !== (q[j][1] > y)) && (x < (q[j][0] - q[i][0]) * (y - q[i][1]) / (q[j][1] - q[i][1]) + q[i][0])) c = !c;
      }
      return c;
    }
    function nodeAt(ev) {
      var r = canvas.getBoundingClientRect(), x = ev.clientX - r.left, y = ev.clientY - r.top, order = depthOrder();
      for (var i = order.length - 1; i >= 0; i--) {
        var n = order[i], m = byId[n.id].dm, hs = m.hs;
        var q = [P(n.x - hs, n.y - hs, m.top), P(n.x + hs, n.y - hs, m.top), P(n.x + hs, n.y - hs, 0), P(n.x + hs, n.y + hs, 0), P(n.x - hs, n.y + hs, 0), P(n.x - hs, n.y + hs, m.top)];
        if (inPoly(q, x, y)) return n.id;
      }
      for (var k = order.length - 1; k >= 0; k--) {   // over the label text
        var nn = order[k], mm = byId[nn.id].dm, p = P(nn.x + mm.hs, nn.y + mm.hs, 0);
        if (Math.abs(x - p[0]) < 36 && y > p[1] + 3 && y < p[1] + 30) return nn.id;
      }
      return null;
    }

    // Tooltip (label + desc), kept inside the visible part of the host even when it is scrolled sideways
    function showTip(id) {
      if (!tip) { tip = document.createElement('div'); tip.className = 'va-tip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; host.appendChild(tip); }
      if (id == null || !byId[id]) { tip.hidden = true; return; }
      var b = byId[id], n = b.d, m = b.dm, p = P(n.x, n.y, m.top);
      tip.textContent = '';
      var t = document.createElement('b'); t.textContent = n.label; tip.appendChild(t);
      if (n.desc) tip.appendChild(document.createTextNode(n.desc));
      tip.hidden = false;
      var tw = tip.offsetWidth, th = tip.offsetHeight, cl = canvas.offsetLeft, ct = canvas.offsetTop;
      var x = cl + p[0] - tw / 2, y = ct + p[1] - th - 12;
      x = Math.max(host.scrollLeft + 4, Math.min(host.scrollLeft + host.clientWidth - tw - 4, x));
      if (y < ct + 2) y = ct + P(n.x + m.hs, n.y + m.hs, 0)[1] + 32;   // no room above: go under the label
      y = Math.max(ct + 2, Math.min(ct + H - th - 2, y));
      tip.style.left = Math.round(x) + 'px'; tip.style.top = Math.round(y) + 'px';
    }

    function layout() { isoLayout(); }
    function draw(now) { isoDraw(now); }

    //──────────── animation ────────────
    // At most 30 frames per second. After IDLE ms without input or scenario change, packets are cleared and the
    // loop stops (battery, low-end phones). Hover, click, touch, coming back into view, returning to the tab or
    // picking a scenario wakes it up again.
    var FRAME = 1000 / 30, IDLE = 18000, lastWake = performance.now(), napping = false;
    function wake() {
      lastWake = performance.now();
      if (napping) { napping = false; if (scn) setScenario(scn.id); }   // restart the flow timing from scratch
      last = 0; schedule();
    }
    // repeat interval of a flow: 1800 ms by default; nonsense values (<= 0, strings) must not spawn a packet every frame
    function every(f) { var e = +f.every; return e > 0 ? Math.max(50, e) : 1800; }
    function tick(now) {
      raf = 0;
      if (destroyed) return;
      if (now - lastWake > IDLE) { napping = true; packets = []; bursts = []; draw(now); return; }
      if (last && now - last < FRAME - 2) { schedule(); return; }
      var dt = Math.min(64, now - (last || now)); last = now;
      flows.forEach(function (fl) { if (now >= fl.next) { trip(fl.f); fl.next = now + every(fl.f); } });
      for (var i = packets.length - 1; i >= 0; i--) {
        var p = packets[i], s = p.segs[p.i];
        if (!s) { packets.splice(i, 1); continue; }
        var pos = posAt(s.c, Math.min(s.len, p.d));
        p.trail.push(pos); if (p.trail.length > 9) p.trail.shift();
        p.d += dt * SPEED;
        if (p.d >= s.len) { p.d -= s.len; p.i++; if (p.i >= p.segs.length) { packets.splice(i, 1); if (p.then) p.then(); } }
      }
      for (var j = bursts.length - 1; j >= 0; j--) { bursts[j].t += dt; if (bursts[j].t > 650) bursts.splice(j, 1); }
      draw(now);
      schedule();
    }
    function schedule() { if (!raf && !reduce && visible && !document.hidden && !destroyed) raf = requestAnimationFrame(tick); }

    //──────────── input ────────────
    function onMove(ev) {
      wake();
      var h = nodeAt(ev);
      if (h !== hover) { hover = h; canvas.style.cursor = h ? 'pointer' : 'default'; draw(performance.now()); showTip(h); }
    }
    function onLeave() { showTip(null); if (hover) { hover = null; canvas.style.cursor = 'default'; draw(performance.now()); } }
    // When the drawing is wider than the host, drag with the mouse to scroll (touch uses native horizontal scrolling)
    var drag = null, dragged = false;
    function onDown(ev) {
      if (ev.button !== 0 || host.scrollWidth <= host.clientWidth + 1) return;
      drag = { x: ev.clientX, left: host.scrollLeft }; dragged = false;
    }
    function onDragMove(ev) {
      if (!drag) return;
      var dx = ev.clientX - drag.x;
      if (Math.abs(dx) > 4) { dragged = true; canvas.style.cursor = 'grabbing'; if (tip) tip.hidden = true; }
      if (dragged) host.scrollLeft = drag.left - dx;
    }
    function onUp() { if (drag) { drag = null; if (dragged) canvas.style.cursor = hover ? 'pointer' : 'default'; } }
    canvas.addEventListener('mousedown', onDown);
    root.addEventListener('mousemove', onDragMove);
    root.addEventListener('mouseup', onUp);
    function onClick(ev) {
      wake();
      if (dragged) { dragged = false; return; }   // the end of a drag is not a click
      var h = nodeAt(ev);
      showTip(h);   // tooltip for the tapped block too
      if (h != null) { select(h); if (opts.onSelect) opts.onSelect(byId[h].src); }
    }
    function select(id) { selected = id != null && byId[id] ? id : null; draw(performance.now()); }
    canvas.addEventListener('mousemove', onMove);
    canvas.addEventListener('mouseleave', onLeave);
    canvas.addEventListener('click', onClick);

    //──────────── size · theme · visibility ────────────
    function relayout() { layout(); if (scn) { var id = scn.id; setScenario(id); } else draw(performance.now()); }
    // Resize is applied on the next frame (changing height inside the observer callback triggers ResizeObserver loop warnings)
    var roFrame = 0;
    var ro = root.ResizeObserver ? new ResizeObserver(function () {
      if (roFrame) return;
      roFrame = requestAnimationFrame(function () { roFrame = 0; if (destroyed) return; var w = Math.floor(hostWidth()); if (w && Math.abs(w - W) > 1) relayout(); });
    }) : null;
    if (ro) ro.observe(host); else root.addEventListener('resize', relayout);
    var mo = new MutationObserver(function () { readTheme(); draw(performance.now()); });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    var mq = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    function onScheme() { readTheme(); draw(performance.now()); }
    if (mq && mq.addEventListener) mq.addEventListener('change', onScheme);
    var io = root.IntersectionObserver ? new IntersectionObserver(function (es) { visible = es[0].isIntersecting; if (visible) wake(); }) : null;
    if (io) io.observe(canvas);
    function onVis() { if (!document.hidden) wake(); }
    document.addEventListener('visibilitychange', onVis);
    canvas.addEventListener('touchstart', wake, { passive: true });

    readTheme(); layout(); draw(performance.now());

    return {
      setScenario: function (id) { napping = false; setScenario(id); wake(); },
      select: function (id) { select(id); wake(); },
      // Current picture: { url, width, height, canvas } (width / height in CSS px)
      toDataURL: function () { draw(performance.now()); return { url: canvas.toDataURL('image/png'), width: CW, height: H, canvas: canvas }; },
      destroy: function () {
        if (destroyed) return;
        destroyed = true; if (raf) cancelAnimationFrame(raf); if (roFrame) cancelAnimationFrame(roFrame);
        if (still) { still.width = still.height = 0; if (still.parentNode) still.parentNode.removeChild(still); still = stillCtx = null; }   // release the cached layer's memory
        if (ro) ro.disconnect(); else root.removeEventListener('resize', relayout);
        mo.disconnect(); if (io) io.disconnect();
        if (mq && mq.removeEventListener) mq.removeEventListener('change', onScheme);
        document.removeEventListener('visibilitychange', onVis);
        root.removeEventListener('mousemove', onDragMove); root.removeEventListener('mouseup', onUp);
        if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
        if (probe.parentNode) probe.parentNode.removeChild(probe);
        if (tip && tip.parentNode) tip.parentNode.removeChild(tip);
        UI_VARS.forEach(function (k) { host.style.removeProperty('--va-ui-' + k); });
        host.style.removeProperty('--va-ui-font');
        if (addedWrap) host.classList.remove('va-wrap');
        if (addedIso) host.classList.remove('is-iso');
      }
    };
  }

  return {
    version: VERSION, create: create, validate: validate, iconOf: iconOf,
    ICONS: ICONS.slice(), ICON_RULES: ICON_RULES.slice(), FLOW_KINDS: FLOW_KINDS.slice(),
    LIGHT: Object.freeze(LIGHT), DARK: Object.freeze(DARK),
    LIMITS: LIMITS, _fitCanvas: fitCanvas   // _fitCanvas: internal, exposed for tests
  };
});
