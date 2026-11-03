const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');

test('an unconfirmed written item survives refresh and cannot be re-enabled by a poll', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/sessionQueue.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
  const item = { id: 'assign:34', source: 'assign', payload: 'body\r', preview: 'task', createdAt: 1 };
  let queues = exports.upsertItem({}, 'agent', item);
  queues = exports.upsertItem(queues, 'agent', { ...item, stuck: true, unconfirmed: true, reason: '전송됨 · 확인 안 됨' });
  queues = JSON.parse(JSON.stringify(queues));
  queues = exports.upsertItem(queues, 'agent', { ...item, reason: '팀원이 응답 중' });
  assert.equal(queues.agent[0].unconfirmed, true);
  assert.equal(queues.agent[0].stuck, true);
  assert.equal(exports.nextUserItem(queues.agent), undefined);
});

test('manual send distinguishes a successful body write from a write failure', () => {
  const bridge = fs.readFileSync('src/lib/tauriBridge.ts', 'utf8');
  const pane = fs.readFileSync('src/components/TerminalPane.tsx', 'utf8');
  const write = bridge.indexOf('await invoke("write_to_session", { sessionId, data: wrapped });');
  assert.ok(write >= 0 && bridge.indexOf('bodyWritten = true;', write) > write);
  assert.match(bridge, /if \(bodyWritten\) throw new SubmissionUnconfirmedError/);
  assert.match(pane, /error instanceof SubmissionUnconfirmedError/);
  assert.match(pane, /disabled=\{it\.unconfirmed\}/);
  assert.match(pane, /sendingQueueRef\.current\.has\(id\)/);
});
