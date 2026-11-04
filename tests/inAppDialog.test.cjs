const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);

test('T1793776116339_1: src에 브라우저 기본 confirm/alert/prompt 없음, 공용 모달이 main에 마운트', () => {
  const hits = walk('src').filter((f) => /\.tsx?$/.test(f)).filter((f) => /\bwindow\.(confirm|alert|prompt)\(|(^|[^.\w])(confirm|alert|prompt)\(/m.test(fs.readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '')));
  assert.deepEqual(hits, []);
  assert.match(fs.readFileSync('src/main.tsx', 'utf8'), /<ConfirmHost \/>/);
  const host = fs.readFileSync('src/components/ConfirmHost.tsx', 'utf8');
  assert.match(host, /e\.key === "Escape"/); // Esc = 취소
  assert.match(host, /e\.key === "Tab"/); // 포커스 트랩
  assert.match(host, /bg-red-600/); // 위험 동작은 붉은 확인 버튼
});

test('T1793776116339_1: confirmDialog는 모달 미마운트 시 false, 마운트 시 resolve 값 반환', async () => {
  const ts = require('typescript'), vm = require('node:vm');
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/confirmDialog.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, Promise });
  assert.equal(await api.confirmDialog({ title: 'x' }), false);
  const off = api.confirmDialogSubscribe((r) => r.resolve(true));
  assert.equal(await api.confirmDialog({ title: 'x' }), true);
  off();
  assert.equal(await api.alertDialog('x'), false);
});

test('T1793776116339_6: danger는 취소에 초기 포커스(Enter=취소), 일반은 확인 포커스(Enter=확인), 취소 버튼 hover', () => {
  const host = fs.readFileSync('src/components/ConfirmHost.tsx', 'utf8');
  assert.ok(host.includes('(cur.danger && cancelRef.current ? cancelRef : okRef).current?.focus()'));
  assert.match(host, /hover:bg-slate-700[^"`]*hover:text-slate-100/);
  // 위험 호출부(작업 취소·앱 초기화)는 danger: true
  assert.match(fs.readFileSync('src/components/TaskApprovalBoard.tsx', 'utf8'), /danger: true/);
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /confirmLabel: "초기화",\s*danger: true/);
});

test('T1793776116339_7: 응답 중 탭 시안 링은 ring-offset으로 활성 탭 테두리와 떨어진다', () => {
  assert.match(fs.readFileSync('src/App.tsx', 'utf8'), /animate-pulse motion-reduce:animate-none ring-2 ring-cyan-400 ring-offset-1 ring-offset-slate-900 /);
});

test('T1793776116339_8: 모달이 열린 동안 isConfirmOpen=true, 닫히면 false, 전역 단축키 핸들러가 early-return', async () => {
  const ts = require('typescript'), vm = require('node:vm');
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/confirmDialog.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: api, Promise });
  let pending;
  api.confirmDialogSubscribe((r) => { pending = r; });
  assert.equal(api.isConfirmOpen(), false);
  const p = api.confirmDialog({ title: 'x' });
  assert.equal(api.isConfirmOpen(), true);
  pending.resolve(true);
  assert.equal(await p, true);
  assert.equal(api.isConfirmOpen(), false);
  const app = fs.readFileSync('src/App.tsx', 'utf8');
  assert.match(app, /const onKeyDown = \(e: KeyboardEvent\) => \{\s*if \(isConfirmOpen\(\)\) return;\s*[^\n]*\s*\/\/ F11/);
  assert.match(fs.readFileSync('src/components/TerminalPane.tsx', 'utf8'), /const onKeyDown = \(e: KeyboardEvent\) => \{\s*if \(isConfirmOpen\(\)\) return;/);
});
