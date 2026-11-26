'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const VA = require('../vanilla-arch.js');

const icon = (label, extra) => VA.iconOf(Object.assign({ id: 'n', label }, extra));

test('explicit node.icon always wins', () => {
  assert.equal(icon('Postgres database', { icon: 'cloud' }), 'cloud');
  assert.equal(icon('Anything', { icon: 'rocket' }), 'rocket');   // unknown names pass through (drawn as a square)
  assert.equal(icon('Payment provider', { kind: 'ext', icon: 'lock' }), 'lock');
});

test('external nodes default to cloud', () => {
  assert.equal(icon('Payment provider', { kind: 'ext' }), 'cloud');
  assert.equal(icon('Postgres', { kind: 'ext' }), 'cloud');
});

test('English defaults', () => {
  const cases = {
    'Shoppers': 'users', 'Customers': 'users', 'Store admin': 'person', 'Mobile app': 'mobile', 'Android client': 'mobile',
    'Email sender': 'bell', 'Notifications': 'bell', 'Monitoring': 'chart', 'Log search': 'chart', 'CI/CD pipeline': 'git',
    'Auth service': 'lock', 'API gateway': 'shield', 'Load balancer': 'shield', 'WebSocket hub': 'bolt', 'Job queue': 'queue',
    'Kafka': 'queue', 'Resize function': 'lambda', 'Redis': 'cache', 'Session cache': 'cache', 'Object storage': 'bucket',
    'CDN': 'bucket', 'Orders DB': 'db', 'PostgreSQL': 'db', 'Inference GPU': 'chip', 'Policy rules': 'doc', 'Nightly batch': 'clock',
    'Background workers': 'clock', 'Cloud provider': 'cloud', 'Web storefront': 'browser', 'React SPA': 'browser',
    'Order service': 'server', 'Catalog': 'server'
  };
  for (const [label, want] of Object.entries(cases)) assert.equal(icon(label), want, label);
});

test('generic Korean defaults', () => {
  const cases = { '사용자': 'users', '고객': 'users', '관리자': 'person', '모바일 앱': 'mobile', '알림': 'bell', '모니터링': 'chart',
    '배포': 'git', '인증 서버': 'lock', '게이트웨이': 'shield', '메시지 큐': 'queue', '캐시': 'cache', '파일 저장소': 'bucket',
    '데이터베이스': 'db', '배치 작업': 'clock', '외부 서비스': 'cloud', '웹 화면': 'browser', '서버': 'server' };
  for (const [label, want] of Object.entries(cases)) assert.equal(icon(label), want, label);
});

test('tech and id are matched too', () => {
  assert.equal(VA.iconOf({ id: 'store', label: 'Primary store', tech: ['MySQL'] }), 'db');
  assert.equal(VA.iconOf({ id: 'redis-main', label: 'Main' }), 'cache');
});

test('missing label or tech does not throw', () => {
  assert.equal(VA.iconOf({ id: 'x' }), 'server');
  assert.equal(VA.iconOf({}), 'server');
  assert.equal(VA.iconOf(null), 'server');
});

test('custom rules replace the defaults; fall back to server', () => {
  const rules = [['chip', /robot/], ['doc', /ledger/]];
  assert.equal(VA.iconOf({ id: 'a', label: 'Robot arm' }, rules), 'chip');
  assert.equal(VA.iconOf({ id: 'a', label: 'Ledger' }, rules), 'doc');
  assert.equal(VA.iconOf({ id: 'a', label: 'Postgres' }, rules), 'server');
  assert.equal(VA.iconOf({ id: 'a', label: 'Postgres' }, rules.concat(VA.ICON_RULES)), 'db');
});

test('every default rule names a drawable icon', () => {
  for (const [name, re] of VA.ICON_RULES) {
    assert.ok(VA.ICONS.includes(name), name);
    assert.ok(re instanceof RegExp);
  }
  assert.equal(VA.ICON_RULES[VA.ICON_RULES.length - 1][0], 'server');
});

