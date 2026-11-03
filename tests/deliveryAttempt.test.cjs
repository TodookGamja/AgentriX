const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

function load(path, requireFn = require) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: requireFn, setTimeout, clearTimeout, Date, Promise, Error });
  return exports;
}

const { DeliveryAttempt, withDeliveryDeadline } = load('src/lib/deliveryAttempt.ts', () => ({ invoke: async () => {} }));
const { queueSessionWrite } = load('src/lib/sessionWriteQueue.ts');

test('a timed out wait releases the caller and a following attempt can proceed', async () => {
  const first = new DeliveryAttempt('s', '1');
  await assert.rejects(withDeliveryDeadline(first, () => new Promise(() => {}), 5), /timeout/);
  const next = new DeliveryAttempt('s', '2');
  assert.equal(await withDeliveryDeadline(next, async () => 42, 50), 42);
});

test('late queued operation cannot commit after cancellation', async () => {
  const attempt = new DeliveryAttempt('s', '1');
  let release, writes = 0;
  const first = queueSessionWrite('s', () => new Promise(resolve => { release = resolve; }));
  await Promise.resolve();
  const later = queueSessionWrite('s', async () => { attempt.commit(); writes++; }, attempt.cancelledPromise);
  attempt.abort();
  await assert.rejects(later, /cancelled/);
  release();
  await first;
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(writes, 0);
});

test('cancelling a hung write frees the per-session queue for another attempt', async () => {
  const attempt = new DeliveryAttempt('s2', '1');
  const hung = queueSessionWrite('s2', () => new Promise(() => {}), attempt.cancelledPromise);
  attempt.abort();
  await assert.rejects(hung, /cancelled/);
  let ran = false;
  await queueSessionWrite('s2', async () => { ran = true; });
  assert.equal(ran, true);
});

test('timeout after commit stays distinguishable as unconfirmed', async () => {
  const attempt = new DeliveryAttempt('s', '1');
  await assert.rejects(withDeliveryDeadline(attempt, async () => { attempt.commit(); await new Promise(() => {}); }, 5), /timeout/);
  assert.equal(attempt.committed, true);
  assert.equal(attempt.cancelled, true);
});

test('delivery wiring keeps committed timeouts blocked and checks before body write', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const bridge = fs.readFileSync('src/lib/tauriBridge.ts', 'utf8');
  assert.match(app, /withDeliveryDeadline\(attempt/);
  assert.match(app, /if \(attempt\.committed\)[\s\S]*?unconfirmed: true/);
  assert.match(app, /if \(existing\?\.stuck\)/);
  const commit = bridge.indexOf('verify?.attempt?.commit()');
  const bodyWrite = bridge.indexOf('data: wrapped', commit);
  assert.ok(commit >= 0 && bodyWrite > commit);
  assert.match(bridge, /verify\?\.attempt\?\.cancelledPromise/);
});
