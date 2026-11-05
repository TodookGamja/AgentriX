/**
 * T1793841150955_2 — Pixel _1 중복 완료 보고 제거 회귀
 * 기준: 메일+✅ → PM 1번, 메일 없이 ✅ → 자동 보고 1번,
 * ✅→메일 순서도 중복·누락 0, _1/_10 ID 오판 0.
 */
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const api = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/blackboardDispatch.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: api },
);
const app = read("src/App.tsx");

const task = (id, status, agentId = "forge") => ({ taskId: id, agentId, status });
const mail = (taskId, agentId = "forge", pm = "pm") => ({
  from: agentId,
  to: pm,
  subject: `${taskId} 결과`,
  body: `${taskId} 작업 완료했습니다.`,
});

/** App.tsx done 분기: mailSeen이면 skip+handled, 아니면 doneTasks→report 1건 */
function autoReports(mails, tasks, pm = "pm", priorSeen = []) {
  const mailSeen = new Set(priorSeen);
  for (const k of api.resultMailTaskKeys(mails, tasks, pm)) mailSeen.add(k);
  const reports = [];
  for (const t of tasks) {
    if (t.status !== "done") continue;
    if (t.agentId === pm) continue;
    const key = `${t.taskId}:${t.agentId}`;
    if (mailSeen.has(key)) continue; // 생략 + handled (실제 App은 remove+markHandled)
    reports.push(`report:${t.taskId}:${t.agentId}`);
  }
  return { reports, mailSeen: [...mailSeen] };
}

test("T2/① 메일 먼저 → ✅: 자동 보고 0 (메일 1번만)", () => {
  const mails = [mail("T9_1")];
  // 🔥 중 메일 도착 → seen 저장
  const mid = autoReports(mails, [task("T9_1", "start")]);
  assert.deepEqual(mid.mailSeen, ["T9_1:forge"]);
  // ✅ 전환
  const after = autoReports(mails, [task("T9_1", "done")], "pm", mid.mailSeen);
  assert.deepEqual(after.reports, []);
});

test("T2/② 메일 없이 ✅만: 자동 보고 정확히 1번", () => {
  const r = autoReports([], [task("T9_1", "done")]);
  assert.deepEqual(r.reports, ["report:T9_1:forge"]);
});

test("T2/③ ✅ 먼저 → 메일 나중: 보고 큐 후 메일 키로 중복 0·누락 0", () => {
  // ✅ 시점에 메일 없음 → 보고 1
  const first = autoReports([], [task("T9_1", "done")]);
  assert.deepEqual(first.reports, ["report:T9_1:forge"]);
  // 이후 결과 메일 도착 → 같은 키 seen, App은 report remove+handled (재전송 0)
  const keys = api.resultMailTaskKeys([mail("T9_1")], [task("T9_1", "done")], "pm");
  assert.deepEqual(keys, ["T9_1:forge"]);
  const again = autoReports([mail("T9_1")], [task("T9_1", "done")], "pm", keys);
  assert.deepEqual(again.reports, []);
});

test("T2/④ ID 단어일치: T9_1 메일이 T9_10 보고를 삼키지 않음 (_1≠_10)", () => {
  assert.equal(api.hasTaskResultMail([mail("T9_1")], "T9_10", "forge", "pm"), false);
  assert.equal(api.hasTaskResultMail([mail("T9_10")], "T9_1", "forge", "pm"), false);
  assert.deepEqual(
    api.resultMailTaskKeys([mail("T9_1")], [task("T9_10", "done")], "pm"),
    [],
  );
  const r = autoReports([mail("T9_1")], [task("T9_10", "done")]);
  assert.deepEqual(r.reports, ["report:T9_10:forge"]); // 누락 0
});

test("T2/⑤ App 배선: mailSeen → remove+markHandled, 없으면 doneTasks→[완료 보고]", () => {
  assert.match(app, /resultMailTaskKeys\(/);
  assert.match(app, /agentrix\.resultMailSeen\./);
  assert.match(
    app,
    /if \(mailSeen\.has\(`\$\{t\.taskId\}:\$\{t\.agentId\}`\)\)[\s\S]{0,350}markHandled\(`\$\{qk\}\|report:/,
  );
  assert.match(app, /\[완료 보고\] \$\{task\.taskId\} 작업이 완료되었습니다/);
  assert.match(app, /doneTasks\.push\(t\)/);
});
