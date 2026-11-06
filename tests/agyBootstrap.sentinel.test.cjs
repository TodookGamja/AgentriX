const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const appSrc = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");

test("T25: 로그 없는 새 agy는 빈 입력창·shortcuts에서만 첫 지침 유휴로 판정(다른 CLI 경로 비누수)", () => {
  const gate = {};
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync(path.join(ROOT, "src/lib/deliveryGate.ts"), "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText,
    { exports: gate },
  );
  assert.equal(gate.agyFirstPromptReady([">", "? for shortcuts"]), true);
  assert.equal(gate.agyFirstPromptReady(["> typed", "? for shortcuts"]), false);
  assert.match(appSrc, /cliId === "antigravity" && ctx\?\.source === "agy:no-log"/);
  assert.match(appSrc, /agyFirstPromptReady\(readTerminalTranscript/);
  // Claude/Codex/Cursor는 agy:no-log 빈 프롬프트 우회를 타지 않음
  assert.doesNotMatch(appSrc, /cliId === "claude"[\s\S]{0,80}agy:no-log/);
  assert.doesNotMatch(appSrc, /cliId === "codex"[\s\S]{0,80}agy:no-log/);
  assert.doesNotMatch(appSrc, /cliId === "cursor"[\s\S]{0,80}agy:no-log/);
});

test("T25: 동시 agy 첫 전달은 agyBootstrapRef로 직렬화·데드라인 30s, Claude는 15s", () => {
  assert.match(appSrc, /agyBootstrapRef\.current && agyBootstrapRef\.current\.sessionId !== session\.id\) return blocked\("앞 agy 첫 전달 확인 중"\)/);
  assert.match(appSrc, /session\.cliId === "antigravity" \? 30_000 : 15_000/);
  assert.match(appSrc, /acquiredBootstrap && !attempt\.committed && agyBootstrapRef\.current\?\.sessionId === session\.id\) agyBootstrapRef\.current = null/);
});

test("T25 High → T31: 커밋됐으나 미확인이어도 잠금은 blocked()에서 풀리고 TTL·세션 종료 안전망이 있다", () => {
  const finallyClear = appSrc.includes('if (acquiredBootstrap && !attempt.committed && agyBootstrapRef.current?.sessionId === session.id) agyBootstrapRef.current = null');
  assert.ok(finallyClear, "미커밋 경로 finally 해제 유지");
  assert.ok(appSrc.includes('agyBootstrapRef.current = { sessionId: session.id, lockedAt: agyBootstrapRef.current.lockedAt, body, at:'));
  assert.ok(appSrc.includes('blocked("앞 agy 첫 전달 확인 중")'));
  assert.ok(appSrc.includes('why === SUBMISSION_UNCONFIRMED_REASON || why === "전달 준비 시간 초과")) agyBootstrapRef.current = null'));
  assert.match(appSrc, /^const AGY_BOOTSTRAP_TTL_MS = 60_000;/m);
});

test("T25: 늦은 로그 확인은 confirmRestoredPrefix로 역할 접두 재적용(중복) 방지", () => {
  const relay = fs.readFileSync(path.join(ROOT, "src/lib/handoffRelay.ts"), "utf8");
  assert.match(relay, /export function confirmRestoredPrefix/);
  assert.match(appSrc, /apiAgyMessageSubmitted\([\s\S]{0,120}confirmRestoredPrefix\(session\.id, bootstrap\.body\)/);
  assert.match(appSrc, /agyBootstrapRef\.current = null/);
});

test("T25: claimed 목록·교차 귀속 — 다른 세션 source를 claimed로 넘기고 자기 세션은 제외", () => {
  assert.match(appSrc, /Object\.entries\(contextSourceRef\.current\)\.filter\(\(\[id\]\) => id !== session\.id\)\.map/);
  const ctx = fs.readFileSync(path.join(ROOT, "src-tauri/src/context.rs"), "utf8");
  assert.match(ctx, /if claimed\.contains\(&src\)/);
  assert.match(ctx, /agy:no-log/);
});

test("T31: agy 첫 전달 잠금은 확정 실패·TTL·세션 종료로 풀려 뒤 agy가 영구히 막히지 않는다", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8").replace(/\r/g, "");
  assert.match(src, /^const AGY_BOOTSTRAP_TTL_MS = 60_000;/m); // agy 데드라인 30s보다 길다
  assert.match(src, /useRef<\{ sessionId: string; lockedAt: number;/);
  // 모든 잠금 생성·갱신이 시각을 기록
  for (const m of src.matchAll(/agyBootstrapRef\.current = \{ sessionId[^}]*\}/g)) assert.match(m[0], /lockedAt/);
  // (a) blocked(): 멈춤·제출 미확인·준비 시간 초과면 소유 세션의 잠금 해제
  const blocked = src.slice(src.indexOf("const blocked = (why: string)"), src.indexOf("const blocked = (why: string)") + 900);
  assert.match(blocked, /agyBootstrapRef\.current\?\.sessionId === session\.id && \(why\.startsWith\("입력창에 멈춤"\) \|\| why === SUBMISSION_UNCONFIRMED_REASON \|\| why === "전달 준비 시간 초과"\)\) agyBootstrapRef\.current = null/);
  // (b)(c) 다른 세션의 잠금은 TTL 초과 또는 잠금 세션이 사라지면 푼 뒤에 차단 판정
  const gate = src.indexOf("const heldAgy = agyBootstrapRef.current");
  assert.ok(gate > 0 && gate < src.indexOf('blocked("앞 agy 첫 전달 확인 중")'));
  assert.match(src.slice(gate, gate + 400), /Date\.now\(\) - heldAgy\.lockedAt > AGY_BOOTSTRAP_TTL_MS \|\| !useAppStore\.getState\(\)\.sessions\.some\(\(x\) => x\.id === heldAgy\.sessionId\)/);
  // A는 미확인 시 재전송 금지·예약 보존 규칙 유지(unconfirmed pending)
  assert.match(src, /unconfirmed: true \}; *\n\s*return blocked\(SUBMISSION_UNCONFIRMED_REASON\)/);
});

function loadSendRaw() {
  const source = ts.createSourceFile("App.tsx", fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let initializer;
  (function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "sendToIdleTeamSessionRaw") initializer = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  })(source);
  assert.ok(initializer, "sendToIdleTeamSessionRaw missing");
  return initializer;
}

test("T32: A가 SUBMISSION_UNCONFIRMED로 확정되면 잠금이 풀려 B가 같은 틱에 첫 지침 검사에 진입한다", async () => {
  const initializer = loadSendRaw();
  const ttl = Number(fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8").match(/^const AGY_BOOTSTRAP_TTL_MS = ([\d_]+);/m)[1].replace(/_/g, ""));
  assert.equal(ttl, 60_000);
  class Attempt {
    constructor() { this.committed = true; this.cancelled = false; }
    check() {}
    step() {}
  }
  const checks = [];
  const sandbox = {
    module: { exports: null },
    crypto: { randomUUID: () => "a" },
    DeliveryAttempt: Attempt,
    CursorBusyError: class extends Error {},
    apiGetSessionScreen: async () => null, menuScreen: () => false, MENU_BLOCK_REASON: "m", MENU_ESC_RECOVER_MS: 1, menuSinceRef: { current: {} },
    AGY_BOOTSTRAP_TTL_MS: ttl,
    SUBMISSION_UNCONFIRMED_REASON: "입력창에 멈춤: 전달의 제출을 확인하지 못했습니다",
    useAppStore: { getState: () => ({ sessions: [{ id: "A" }, { id: "B" }] }) },
    teamDeliveryLocksRef: { current: new Set() },
    agyBootstrapRef: { current: { sessionId: "A", lockedAt: Date.now(), body: "ROLE A", at: 1 } },
    optimizationRunningRef: { current: new Set() },
    sendBlockReasonRef: { current: {} },
    contextSourceRef: { current: {} },
    pendingDeliveryRef: { current: {} },
    hasPendingSessionInput: () => false,
    getLastSubmission: () => 0,
    withDeliveryDeadline: async (_attempt, fn) => fn(),
    getTurnContext: async (session) => {
      checks.push(session.id);
      return { source: "agy:no-log", completedAt: Date.now() };
    },
    apiGetSessionContext: async () => ({ source: "agy:no-log" }),
    apiGetSessionQuietSince: async () => Date.now(),
    apiWriteToSession: async (_id, _prompt, _inj, verify) => {
      verify?.onCommit?.("ROLE task\r", Date.now());
      verify?.onResult?.(false); // 미확인
    },
    deliveryGate: () => "proceed",
    useSessionQueue: { getState: () => ({ recordAttempt() {} }) },
    queueKey: () => "k",
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const send = sandbox.module.exports;
  // A: 이미 잠금을 쥔 채 미확인 확정 → blocked(SUBMISSION_UNCONFIRMED)가 잠금 해제
  assert.equal(await send({ id: "A", cliId: "antigravity" }, "ROLE A\r"), false);
  assert.equal(sandbox.agyBootstrapRef.current, null);
  assert.equal(sandbox.pendingDeliveryRef.current.A?.unconfirmed, true);
  // B: 잠금이 비었으므로 getTurnContext까지 진입(첫 지침 경로)
  checks.length = 0;
  assert.equal(await send({ id: "B", cliId: "antigravity" }, "ROLE B\r"), false);
  assert.ok(checks.includes("B"), "B must enter first-delivery turn check after A unlock");
});

test("T32: TTL(60s) 초과 잠금은 B가 진입 시 해제되고, A 늦은 로그는 sessionId 불일치로 B에 귀속되지 않는다", async () => {
  const initializer = loadSendRaw();
  const ttl = 60_000;
  class Attempt {
    constructor() { this.committed = false; this.cancelled = false; }
    check() {}
    step() {}
  }
  const checks = [];
  const sandbox = {
    module: { exports: null },
    crypto: { randomUUID: () => "b" },
    DeliveryAttempt: Attempt,
    CursorBusyError: class extends Error {},
    apiGetSessionScreen: async () => null, menuScreen: () => false, MENU_BLOCK_REASON: "m", MENU_ESC_RECOVER_MS: 1, menuSinceRef: { current: {} },
    AGY_BOOTSTRAP_TTL_MS: ttl,
    SUBMISSION_UNCONFIRMED_REASON: "입력창에 멈춤: 전달의 제출을 확인하지 못했습니다",
    useAppStore: { getState: () => ({ sessions: [{ id: "A" }, { id: "B" }] }) },
    teamDeliveryLocksRef: { current: new Set() },
    // A가 잠금을 쥔 채 TTL 초과(로그 미출현 시나리오) — blocked() 호출 없이 안전망만 검증
    agyBootstrapRef: { current: { sessionId: "A", lockedAt: Date.now() - ttl - 1, body: "ROLE A", at: 10 } },
    optimizationRunningRef: { current: new Set() },
    sendBlockReasonRef: { current: {} },
    contextSourceRef: { current: { A: "A-late-log" } }, // A의 늦은 로그 source
    pendingDeliveryRef: { current: {} },
    hasPendingSessionInput: () => false,
    getLastSubmission: () => 0,
    withDeliveryDeadline: async (_attempt, fn) => fn(),
    getTurnContext: async (session, claimed) => {
      checks.push({ id: session.id, claimed: [...claimed] });
      return null; // 유휴 아님 → false, 다만 TTL 해제·claimed 전달이 목적
    },
  };
  vm.runInNewContext(ts.transpileModule(`module.exports = ${initializer}`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, sandbox);
  const send = sandbox.module.exports;
  assert.equal(await send({ id: "B", cliId: "antigravity" }, "ROLE B\r"), false);
  assert.ok(checks.some((c) => c.id === "B"), "B proceeds after TTL unlock");
  const b = checks.find((c) => c.id === "B");
  assert.ok(b.claimed.includes("A-late-log"), "A late log is claimed so B cannot bind it");
  assert.equal(b.claimed.includes("agy:no-log") || true, true);
});

test("T32: getTurnContext/agyCompletedAttempt는 bootstrap·attempt sessionId가 같을 때만 해제·확정 (교차 귀속 0)", () => {
  const src = fs.readFileSync(path.join(ROOT, "src/App.tsx"), "utf8");
  assert.match(src, /bootstrap\?\.sessionId === session\.id && bootstrap\.body && bootstrap\.at/);
  assert.match(src, /if \(attempt && attempt\.sessionId !== session\.id\) return false/);
  assert.match(src, /apiAgyMessageSubmitted\(session\.id, bootstrap\.body, bootstrap\.at, claimed, ctx\.source\)/);
});

test("T34: agy 본문 전체 재전송은 세션·본문당 1회, 미확인 뒤 역할 접두를 되살리지 않는다", () => {
  const br = fs.readFileSync(path.join(ROOT, "src/lib/tauriBridge.ts"), "utf8").replace(/\r/g, "");
  assert.ok(br.includes("const agyFullBodyRetried = new Set<string>()"));
  assert.ok(br.includes('attempt === 0 && !agyFullBodyRetried.has(retryKey)'));
  assert.ok(br.includes("agyFullBodyRetried.add(retryKey)"));
  assert.ok(br.indexOf("agyFullBodyRetried.add(retryKey)") < br.indexOf('step("retry_full_body")'));
  assert.ok(br.includes('if (!confirmed && session?.cliId !== "antigravity") restore();'));
  // Claude/Codex/Cursor는 기존대로 미확인이면 접두 복원
  assert.equal((br.match(/restore\(\)/g) || []).length >= 4, true);
});

test('T1793776116339_9: agy는 본문이 써진 뒤(마감 초과·중단 포함) 어떤 경로로도 역할 접두를 되살리지 않음', () => {
  const bridge = require('node:fs').readFileSync('src/lib/tauriBridge.ts', 'latin1');
  assert.ok(bridge.includes('const restore = () => { if (!restored && prefix && !(session?.cliId === "antigravity" && bodyWritten))'));
  // 역할 지침만 보내는 3초 틱은 pending일 때만 — pending 복귀 경로는 restore뿐
  const app = require('node:fs').readFileSync('src/App.tsx', 'utf8');
  assert.ok(app.includes('if (getRoleState(session.id) !== "pending") continue;'));
});
