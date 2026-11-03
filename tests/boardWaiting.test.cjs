const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/blackboardDispatch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });

test('waiting rows are visible only when explicitly requested', () => {
  const board = '| ID | 제목 | 담당 | 상태 |\n| T123 | 작업 | agent | ⏳ 대기 |';
  assert.equal(api.parseBoardTasks(board, ['agent']).length, 0);
  assert.equal(api.parseBoardTasks(board, ['agent'], undefined, true)[0].status, 'wait');
});

test('only a confirmed submission is running', () => {
  const base = { status: 'start', manual: false, confirmed: false, live: true, queued: false };
  assert.equal(api.boardTaskColumn(base), 'waiting');
  assert.equal(api.boardTaskColumn({ ...base, confirmed: true }), 'running');
  assert.equal(api.boardTaskColumn({ ...base, confirmed: true, queued: true }), 'waiting');
  assert.equal(api.boardTaskColumn({ ...base, confirmed: true, live: false }), 'waiting');
  assert.equal(api.boardTaskColumn({ ...base, manual: true }), 'approval');
  assert.equal(api.boardTaskColumn({ ...base, status: 'wait' }), 'waiting');
  assert.equal(api.boardTaskColumn({ ...base, status: 'done' }), 'done');
  assert.equal(api.boardTaskColumn({ ...base, approval: 'rejected' }), 'rejected');
});

test('board keeps five fixed columns and displays wait reasons separately', () => {
  const view = fs.readFileSync('src/components/TaskApprovalBoard.tsx', 'utf8');
  const columns = ['승인 대기', '대기', '진행 중', '완료', '반려'].map((label) => view.indexOf(`column("${label}"`));
  assert.ok(columns.every((position) => position >= 0));
  assert.deepEqual(columns, [...columns].sort((a, b) => a - b));
  assert.match(view, /md:grid-cols-5/);
  assert.match(view, /tone\.includes\("indigo"\)/);
  assert.match(view, /tone\.includes\("sky"\) && notes\[c\.taskId\]/);
});
