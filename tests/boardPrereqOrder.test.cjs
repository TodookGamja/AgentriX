const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const vm = require('node:vm');
const api = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/blackboardDispatch.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api });

const head = '| ID | 작업 | 담당 | 선행 | 기준 | 상태 |\n|---|---|---|---|---|---|\n';
const board = (rows) => head + rows.join('\n');

test('T26: 선행이 안 끝난 🔥 행은 전달(기본 파싱)에서 빠지고, 작업보드에는 blockedBy로 남는다', () => {
  const b = board(['| T1_1 | a | agent | — | x | 🔥 착수 |', '| T1_2 | b | agent | T1_1 | x | 🔥 착수 |', '| T1_3 | c | agent | _2 | x | 🔥 착수 |']);
  assert.equal(JSON.stringify(api.parseBoardTasks(b, ['agent']).map((t) => t.taskId)), '["T1_1"]');
  const all = api.parseBoardTasks(b, ['agent'], undefined, true);
  assert.equal(JSON.stringify(all.find((t) => t.taskId === 'T1_2').blockedBy), '["T1_1"]');
  assert.equal(JSON.stringify(all.find((t) => t.taskId === 'T1_3').blockedBy), '["T1_2"]'); // _N 약식은 같은 묶음
  assert.equal(all.find((t) => t.taskId === 'T1_1').blockedBy, undefined);
});

test('T26: 선행이 ✅/통합/취소거나 표에 없으면 막지 않는다', () => {
  const b = board(['| T1_1 | a | agent | — | x | ✅ 완료 |', '| T1_2 | b | agent | — | x | 취소 — 메모 |', '| T1_3 | c | agent | T1_1, T1_2, T9_9 | x | 🔥 착수 |']);
  assert.equal(JSON.stringify(api.parseBoardTasks(b, ['agent']).map((t) => t.taskId).sort()), '["T1_1","T1_2","T1_3"]');
});

test('T26: 상태는 맨 앞 표시만 판정 — 메모 속 ⏳/🔥는 무시, 표시로 시작하지 않으면 형식 오류', () => {
  assert.equal(api.statusKind('✅ 완료 — 이전엔 ⏳ 대기였음'), 'done');
  assert.equal(api.statusKind('보류 메모 ⏳ 재착수'), null);
  const b = board(['| T1_1 | a | agent | — | x | 보류 메모 ⏳ 재착수 |', '| T1_2 | b | agent | — | x | 진행 중 |']);
  assert.equal(api.parseBoardTasks(b, ['agent']).length, 0);
  const all = api.parseBoardTasks(b, ['agent'], undefined, true);
  assert.equal(JSON.stringify(all.map((t) => [t.taskId, t.status])), '[["T1_1","invalid"]]'); // 표시가 전혀 없는 행은 기존처럼 무시
  assert.equal(api.boardTaskColumn({ status: 'invalid', manual: false, confirmed: true, live: true, queued: false }), 'waiting');
});

test('T26: 선행 미충족 카드는 이미 전달 확인됐어도 대기 칸', () => {
  assert.equal(api.boardTaskColumn({ status: 'start', blocked: true, manual: false, confirmed: true, live: true, queued: false }), 'waiting');
  assert.equal(api.boardTaskColumn({ status: 'start', manual: false, confirmed: true, live: true, queued: false }), 'running');
});

test('T26: 대기 정렬 — 선행 충족 → 최신 묶음 → ID 번호 순', () => {
  const rows = [{ taskId: 'T100_5', blockedBy: ['x'] }, { taskId: 'T100_2' }, { taskId: 'T200_9' }, { taskId: 'T200_3' }];
  assert.equal(JSON.stringify(rows.sort(api.compareWaiting).map((t) => t.taskId)), '["T200_3","T200_9","T100_2","T100_5"]');
});

test('T26: 취소는 ID가 정확히 일치하는 행의 상태 칸만 바꾸고 나머지 표는 그대로', () => {
  const b = board(['| T1_1 | a | agent | — | x | 🔥 착수 |', '| T1_12 | b | agent | — | x | 🔥 착수 |', '| T1_2 | c | agent | — | x | ✅ 완료 |']).replace(/\n/g, '\r\n');
  const next = api.cancelBoardRow(b, 'T1_1');
  const lines = next.split('\r\n');
  assert.equal(lines[2], '| T1_1 | a | agent | — | x | 취소 — 사용자 작업판에서 취소 |');
  assert.equal(lines[3], '| T1_12 | b | agent | — | x | 🔥 착수 |'); // 부분 일치 금지
  assert.equal(lines[4], '| T1_2 | c | agent | — | x | ✅ 완료 |');
  assert.equal(lines.length, 5);
  assert.equal(api.cancelBoardRow(b, 'T1_2'), null); // 이미 완료
  assert.equal(api.cancelBoardRow(b, 'T1'), null);
  // 취소 후에는 전달 대상이 아니고 완료(closed) 칸
  assert.equal(JSON.stringify(api.parseBoardTasks(next, ['agent']).filter((t) => t.taskId === 'T1_1').map((t) => t.status)), '["closed"]');
});

test('T26: 작업보드 UI — 대기·진행 카드에 취소(확인창), 30분 미만 완료 신호 없음은 경고색 아님', () => {
  const src = fs.readFileSync('src/components/TaskApprovalBoard.tsx', 'utf8').replace(/\r/g, '');
  assert.match(src, /window\.confirm\(`\$\{c\.taskId\} 작업을 취소할까요/);
  assert.match(src, /waiting, cancelButton\)/);
  assert.match(src, /running, cancelButton\)/);
  assert.match(src, /\(\\d\+\)분째\/\)\?\.\[1\] \?\? 99999\) < 30/);
  assert.match(src, /waiting = cards\.filter\(\(c\) => kindOf\(c\) === "waiting"\)\.sort\(compareWaiting\)/);
});
