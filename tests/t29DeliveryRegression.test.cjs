const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

test('all automatic and user items share FIFO and same ID is not duplicated', () => {
  const source = fs.readFileSync('src/lib/sessionQueue.ts', 'utf8');
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  let map = {};
  const task = { id: 'assign:1', source: 'assign', payload: 'a', preview: 'a', createdAt: 1 };
  const mail = { id: 'mail:2', source: 'mail', payload: 'b', preview: 'b', createdAt: 2 };
  map = exports.upsertItem(map, 'agent', task);
  map = exports.upsertItem(map, 'agent', mail);
  map = exports.upsertItem(map, 'agent', task);
  map = JSON.parse(JSON.stringify(map));
  assert.equal(map.agent.length, 2);
  assert.equal(exports.nextQueueItem(map.agent).id, 'assign:1');
  map = exports.removeItem(map, 'agent', 'assign:1');
  assert.equal(exports.nextQueueItem(map.agent).id, 'mail:2');
});

test('submission is recorded after the PTY accepts Enter', () => {
  const bridge = fs.readFileSync('src/lib/tauriBridge.ts', 'utf8');
  const enter = bridge.indexOf('await invoke("write_to_session", { sessionId, data: "\\r" });');
  assert.ok(enter >= 0);
  assert.ok(bridge.indexOf('recordSessionSubmission(sessionId)', enter) > enter);
  assert.match(bridge, /recordSessionInput\(sessionId, data, injected, false\)/);
});

test('unconfirmed automatic deliveries retain their reservation', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /unconfirmed: true/);
  assert.match(app, /delivery\.unconfirmed/);
  assert.doesNotMatch(app, /shouldRedeliver\(/);
  assert.match(app, /if \(delivery\.unconfirmed\) continue/);
  const store = fs.readFileSync('src/lib/sessionQueueStore.ts', 'utf8');
  assert.match(store, /queues: s\.queues, resolved: s\.resolved, handled: s\.handled/);
});

test('assignment, approval, mail and report use the shared FIFO gate', () => {
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  const queue = fs.readFileSync('src/lib/sessionQueue.ts', 'utf8');
  assert.match(app, /queues\[key\]\?\.find\(\(item\) => !item\.unconfirmed\)\?\.id !== meta\.id/);
  assert.match(app, /source: "assign"/);
  assert.match(app, /source: "mail"/);
  assert.match(app, /source: "report"/);
  assert.doesNotMatch(app, /\.dropStale\(/);
  assert.match(queue, /list\.findIndex\(\(x\) => x\.id === item\.id\)/);
});
