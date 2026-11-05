/**
 * T1793845112668_2 — Pixel _1 새 세션 착수 재전달 회귀
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
const gate = {};
vm.runInNewContext(
  ts.transpileModule(read("src/lib/deliveryGate.ts"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  { exports: gate },
);
const app = read("src/App.tsx");

const starts = [
  { taskId: "T1_1", agentId: "a" },
  { taskId: "T1_2", agentId: "b" },
];

test("T2/① 재시작·릴레이·앱재실행: 해당 팀원 🔥만 1회, 같은 세션 중복 0", () => {
  const first = api.newSessionResends(
    [
      { id: "s1", agentId: "a" },
      { id: "s2", agentId: "b" },
    ],
    {},
    starts,
  );
  assert.deepEqual([...first.keys], ["T1_1:start:a", "T1_2:start:b"]);
  assert.deepEqual(
    [
      ...api.newSessionResends(
        [
          { id: "s1", agentId: "a" },
          { id: "s2", agentId: "b" },
        ],
        first.seen,
        starts,
      ).keys,
    ],
    [],
  );
  const re = api.newSessionResends(
    [
      { id: "s3", agentId: "a" },
      { id: "s2", agentId: "b" },
    ],
    first.seen,
    starts,
  );
  assert.deepEqual([...re.keys], ["T1_1:start:a"]); // b 오전달 0
});

test("T2/② 재개(resumed)·이미 받은 세션: 재전달 0, seen만 갱신", () => {
  const seen = { a: "s1", b: "s2" };
  const resumed = api.newSessionResends([{ id: "s4", agentId: "a", resumed: true }], seen, starts);
  assert.deepEqual([...resumed.keys], []);
  assert.equal(resumed.seen.a, "s4");
});

test("T2/③ ✅·취소 행은 starts에 없어 재전달 0 · 빈 starts", () => {
  assert.deepEqual(
    [...api.newSessionResends([{ id: "s9", agentId: "a" }], { a: "s0" }, []).keys],
    [],
  );
});

test("T2/④ 같은 팀원 동시 세션: 번갈아 재전달 루프 0 (첫 세션만 추적)", () => {
  let r = api.newSessionResends(
    [
      { id: "s1", agentId: "a" },
      { id: "s2", agentId: "a" },
    ],
    {},
    starts,
  );
  assert.deepEqual([...r.keys], ["T1_1:start:a"]);
  assert.equal(r.seen.a, "s1");
  r = api.newSessionResends(
    [
      { id: "s1", agentId: "a" },
      { id: "s2", agentId: "a" },
    ],
    r.seen,
    starts,
  );
  assert.deepEqual([...r.keys], []);
  r = api.newSessionResends(
    [
      { id: "s2", agentId: "a" },
      { id: "s1", agentId: "a" },
    ],
    r.seen,
    starts,
  );
  // 순서가 바뀌어도 '첫 세션'이 s2로 바뀐 1회만, 이후 안정
  assert.deepEqual([...r.keys], ["T1_1:start:a"]);
  assert.equal(r.seen.a, "s2");
  r = api.newSessionResends(
    [
      { id: "s2", agentId: "a" },
      { id: "s1", agentId: "a" },
    ],
    r.seen,
    starts,
  );
  assert.deepEqual([...r.keys], []);
});

test("T2/⑤ App 배선: agentrix_bb_session_seen + sent/unmark, 릴레이는 별도 순차(게이트 끼어들기 0)", () => {
  assert.match(app, /agentrix_bb_session_seen:\$\{project\}/);
  assert.match(app, /newSessionResends\(projSessions/);
  assert.match(app, /r\.keys\.forEach\(\(k\) => sent\.delete\(k\)\)/);
  assert.match(app, /st\.unmark\(/);
  assert.match(app, /status === "start"/); // starts 필터
  // 릴레이 합치지 않음(Pixel 한계) → 배정은 deliveryGate로 순차
  assert.equal(gate.deliveryGate({ at: 1 }, false, null, 20_000), "wait");
  assert.equal(gate.deliveryGate({ at: 1, started: true }, true, 9_000, 20_000), "proceed");
});
