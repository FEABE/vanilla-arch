/* Example page wiring. Everything here is plain DOM; the diagram is VanillaArch.create(). */
(function () {
  'use strict';
  var state = { errors: [], csp: [], selected: null, diagram: null, data: null };
  window.__demo = state;   // handy for poking around in the console
  window.addEventListener('error', function (e) { state.errors.push(String(e.message)); status(); });
  document.addEventListener('securitypolicyviolation', function (e) { state.csp.push(e.violatedDirective + ' ' + (e.blockedURI || '')); status(); });

  var $ = function (id) { return document.getElementById(id); };
  var host = $('diagram'), problems = [];

  function status() {
    var parts = [];
    parts.push(problems.length ? problems.length + ' data problem(s): ' + problems.join('; ') : 'data OK');
    parts.push('errors: ' + state.errors.length);
    parts.push('CSP violations: ' + state.csp.length);
    $('status').textContent = parts.join(' · ');
  }

  function load(file) {
    return fetch(file).then(function (r) { if (!r.ok) throw new Error(file + ': ' + r.status); return r.json(); });
  }

  function show(A) {
    if (state.diagram) state.diagram.destroy();
    state.data = A;
    problems = VanillaArch.validate(A);
    $('title').textContent = A.title || '(untitled diagram)';
    $('selected').textContent = 'Click a block.';
    var nav = $('scenarios'); nav.textContent = '';
    var scns = A.scenarios || [];
    state.diagram = VanillaArch.create(host, A, {
      onSelect: function (node) {
        state.selected = node.id;
        var p = $('selected'); p.textContent = '';
        var b = document.createElement('b'); b.textContent = node.label; p.appendChild(b);
        if (node.desc) p.appendChild(document.createTextNode(' — ' + node.desc));
      }
    });
    function pick(id) {
      state.diagram.setScenario(id);
      Array.prototype.forEach.call(nav.children, function (btn) { btn.setAttribute('aria-pressed', String(btn.getAttribute('data-id') === id)); });
      var s = scns.filter(function (x) { return x.id === id; })[0];
      $('scn-desc').textContent = s && s.desc ? s.desc : '';
    }
    scns.forEach(function (s) {
      var btn = document.createElement('button');
      btn.type = 'button'; btn.textContent = s.label || s.id; btn.setAttribute('data-id', s.id);
      btn.addEventListener('click', function () { pick(s.id); });
      nav.appendChild(btn);
    });
    var none = document.createElement('button');
    none.type = 'button'; none.textContent = 'None'; none.setAttribute('data-id', '');
    none.addEventListener('click', function () { pick(''); });
    nav.appendChild(none);
    pick(scns.length ? scns[0].id : '');
    status();
  }

  // Theme: auto (follows the OS) -> light -> dark
  var themes = ['auto', 'light', 'dark'], ti = 0;
  $('theme').addEventListener('click', function () {
    ti = (ti + 1) % themes.length;
    if (themes[ti] === 'auto') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', themes[ti]);
    $('theme').textContent = 'Theme: ' + themes[ti];
  });

  $('export').addEventListener('click', function () {
    var snap = state.diagram.toDataURL();
    $('export-img').src = snap.url;
    $('export-cap').textContent = snap.width + ' × ' + snap.height + ' CSS px (transparent background)';
    $('export-out').hidden = false;
  });

  $('example').addEventListener('change', function () { load(this.value).then(show, fail); });
  function fail(e) { state.errors.push(String(e && e.message || e)); status(); }
  load('shop.json').then(show, fail);
})();
