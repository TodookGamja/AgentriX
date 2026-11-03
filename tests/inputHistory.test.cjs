const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");
const ROOT = path.resolve(__dirname, "..");

const source = fs.readFileSync("src/lib/inputHistory.ts", "utf8");
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const api = {};
vm.runInNewContext(js, { exports: api, Date, Map });

test("only user input cancels a delivery retry", () => {
  const id = "retry-version";
  const version = api.getUserInputVersion(id);
  api.recordSessionInput(id, "team message\r", true);
  api.recordSessionInput(id, "\x1b[I");
  assert.equal(api.getUserInputVersion(id), version);
  api.recordSessionInput(id, "한");
  assert.equal(api.getUserInputVersion(id), version + 1);
});

test("stale typed buffer stops blocking team delivery after TTL", () => {
  api.recordSessionInput("s1", "abc");
  const now = Date.now();
  assert.equal(api.hasPendingSessionInput("s1", now), true);
  assert.equal(api.hasPendingSessionInput("s1", now + api.PENDING_INPUT_TTL_MS + 1), false);
  api.recordSessionInput("s1", "\r");
  assert.equal(api.hasPendingSessionInput("s1", now), false);
});

test("injected input updates turn tracking but not instruction history or typed buffer", () => {
  const before = api.getSubmissionVersion("inj");
  api.recordSessionInput("inj", "[역할 브리핑] 당신은 Pixel입니다\r", true);
  assert.equal(api.getSubmissionVersion("inj"), before + 1);
  assert.equal(api.getSessionInputHistory("inj").length, 0);
  assert.equal(api.hasPendingSessionInput("inj"), false);
  api.recordSessionInput("inj", "사용자 지시\r");
  assert.equal(JSON.stringify(api.getSessionInputHistory("inj")), JSON.stringify(["사용자 지시"]));
});

// T1793584554469_4: 입력창이 비었는데 '입력창에 30초 안에 친 글이 남아 있음'이 유지되는 경로 재현
const fresh = (id) => { api.forgetSessionInput(id); return id; };
const pend = (id) => api.hasPendingSessionInput(id);

test("T4: 포커스 보고·마우스 보고 같은 자동 응답은 입력 중 판정을 갱신하거나 버퍼를 오염시키지 않는다", () => {
  const id = fresh("t4a");
  api.recordSessionInput(id, "\x1b[I");
  api.recordSessionInput(id, "\x1b[<0;10;5M");
  api.recordSessionInput(id, "\x1b[O");
  assert.equal(pend(id), false);
  // 타이핑 후 TTL 직전에 포커스 보고가 와도 타이머가 연장되면 안 된다
  api.recordSessionInput(id, "abc");
  const t0 = Date.now();
  api.recordSessionInput(id, "\x1b[I");
  assert.equal(api.hasPendingSessionInput(id, t0 + api.PENDING_INPUT_TTL_MS + 1), false);
});

test("T4: Ctrl+W·Alt+Backspace(단어 삭제)·Ctrl+K·Ctrl+A+Ctrl+K 후 빈 입력창이면 대기 아님", () => {
  for (const k of ["\x17", "\x1b\x7f", "\x1b\b"]) {
    const id = fresh("t4b");
    api.recordSessionInput(id, "hello");
    api.recordSessionInput(id, k);
    assert.equal(pend(id), false, JSON.stringify(k));
  }
});

test("T4: 한글 입력 후 Backspace로 모두 지우면 대기 아님, 보내면 대기 아님", () => {
  const id = fresh("t4c");
  api.recordSessionInput(id, "안");
  api.recordSessionInput(id, "녕");
  assert.equal(pend(id), true);
  api.recordSessionInput(id, "\x7f");
  api.recordSessionInput(id, "\x7f");
  assert.equal(pend(id), false);
  api.recordSessionInput(id, "안녕하세요");
  api.recordSessionInput(id, "\r");
  assert.equal(pend(id), false);
});

test("T4: TUI 질의에 대한 xterm 자동 응답(커서 위치·색상 OSC)은 입력 중으로 치지 않는다", () => {
  const id = fresh("t4d");
  for (const d of ["\x1b[12;5R", "\x1b[?1;2c", "\x1b]11;rgb:0000/0000/0000\x07", "\x1b]11;rgb:0000/0000/0000\x1b\\"]) api.recordSessionInput(id, d);
  assert.equal(pend(id), false);
  api.recordSessionInput(id, "x");
  api.recordSessionInput(id, "\x1b]11;rgb:0000/0000/0000\x07");
  assert.equal(pend(id), true); // 글자는 그대로 남고
  api.recordSessionInput(id, "\x7f");
  assert.equal(pend(id), false); // 오염 없이 지워진다
});

// T1793584554469_6: AUTO 필터가 붙여넣기·방향키·Enter를 잘못 버리지 않음
test("T6: bracketed paste 본문은 유지되고 ESC[200~/201~ 마커만 무시", () => {
  const id = fresh("t6paste");
  api.recordSessionInput(id, "\x1b[200~");
  assert.equal(pend(id), false);
  api.recordSessionInput(id, "\x1b[200~붙여넣기문장\x1b[201~");
  assert.equal(pend(id), true);
  api.recordSessionInput(id, "\r");
  assert.equal(pend(id), false);
  assert.equal(api.getSessionInputHistory(id).at(-1), "붙여넣기문장");
});

test("T6: 방향키 단독은 버퍼·pending 미갱신, Enter는 제출·pending 해제", () => {
  const id = fresh("t6keys");
  for (const k of ["\x1b[A", "\x1b[B", "\x1b[C", "\x1b[D"]) api.recordSessionInput(id, k);
  assert.equal(pend(id), false);
  api.recordSessionInput(id, "ok");
  assert.equal(pend(id), true);
  api.recordSessionInput(id, "\x1b[A"); // 타이핑 중 방향키도 글자를 지우지 않음
  assert.equal(pend(id), true);
  api.recordSessionInput(id, "\r");
  assert.equal(pend(id), false);
  assert.equal(api.getSessionInputHistory(id).at(-1), "ok");
});

test("T6: App sendToIdleTeamSessionRaw 공통 경로 — 락 사유·pending 가드 배선", () => {
  const app = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(app, /teamDeliveryLocksRef\.current\.has\(session\.id\)[\s\S]{0,120}앞 전달 처리 중/);
  assert.match(app, /hasPendingSessionInput\(session\.id\)[\s\S]{0,60}입력창에 30초 안에 친 글이 남아 있음/);
  // 사용자 대기열·배정·완료보고 모두 sendToIdleTeamSession
  assert.match(app, /nextUserItem[\s\S]{0,220}sendToIdleTeamSession/);
  assert.match(app, /sendToIdleTeamSession\([\s\S]{0,500}source: "assign"/);
  assert.match(app, /sendToIdleTeamSession\([\s\S]{0,500}source: "report"/);
  const bridge = fs.readFileSync(path.join(ROOT, "src/lib/tauriBridge.ts"), "utf8");
  assert.match(bridge, /recordSessionInput\(sessionId, data, injected, false\)/);
});
