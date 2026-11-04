const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r/g, "");

test("T1793752130651_8: 30초 무출력 안내는 startedAt+nextCursor===0, 출력 오면 해제", () => {
  const tp = read("src/components/TerminalPane.tsx");
  assert.match(tp, /const SILENT_SESSION_MS = 30_000/);
  assert.match(
    tp,
    /setSilentSession\(!!session\.resumed && chunk\.nextCursor === 0 && Date\.now\(\) - Date\.parse\(session\.startedAt\) > SILENT_SESSION_MS\)/,
  );
  // 마운트 시각이 아닌 startedAt 기준 → 느린 첫 응답 CLI는 일시 오탐 가능, nextCursor>0이면 false로 복귀
  assert.doesNotMatch(tp, /setSilentSession\([^)]*mountedAt|Date\.now\(\)\s*-\s*mount/);
  assert.match(tp, /릴레이로 다시 열기/);
  assert.match(tp, /silentSession &&/);
});

test("T1793752130651_8: 무출력 안내·릴레이는 cliId 분기 없이 공통(Codex/Cursor/agy 회귀 가드)", () => {
  const tp = read("src/components/TerminalPane.tsx");
  const banner = tp.slice(tp.indexOf("{silentSession &&"), tp.indexOf("{silentSession &&") + 1300);
  assert.ok(banner.includes("릴레이로 다시 열기"));
  assert.doesNotMatch(banner, /cliId\s*===|session\.cliId/);
  const app = read("src/App.tsx");
  assert.match(app, /onTriggerRelay=\{\(sid\)\s*=>\s*handleAutoRelaySession\(sid,\s*true\)\}/);
});

test("T1793752130651_8: pty 잘린 재생은 cursor<start에서만 첫 줄바꿈(4KB) 스킵", () => {
  const pty = read("src-tauri/src/pty.rs");
  const fnStart = pty.indexOf("fn read_from(buf: &OutputBuffer");
  const fn = pty.slice(fnStart, pty.indexOf("mod buffer_tests", fnStart));
  assert.match(fn, /if cursor < buf\.start/);
  assert.match(fn, /take\(4096\)\.position\(\|&b\| b == b'\\n'\)/);
  // 비절단(cursor>=start) 경로에는 줄바꿈 스킵 없음 — 함수 내 한 곳만
  assert.equal((fn.match(/take\(4096\)\.position/g) || []).length, 1);
  assert.match(pty, /fn truncated_replay_starts_after_first_newline_not_mid_escape/);
  assert.match(pty, /fn truncated_replay_keeps_short_buffer_without_newline/);
});

test("T1793752130651_8: _7은 원인 확정 없이 완화책(빈 화면 복구+절단 재생) — Critical 아님", () => {
  const tp = read("src/components/TerminalPane.tsx");
  // 복구 UX는 존재하되, 세션 kill/재개 강제 아님
  assert.match(tp, /이어하기한 긴 대화는 응답이 늦는 중일 수 있어요/);
  assert.doesNotMatch(tp, /apiStopSession|forceResume|killSession/);
});

test("T1793752130651_8+Prism _11: role=alert·포커스링, 폴링 재설정으로 DOM 재마운트 없음", () => {
  const tp = read("src/components/TerminalPane.tsx");
  const banner = tp.slice(tp.indexOf("{silentSession &&"), tp.indexOf("{silentSession &&") + 1100);
  assert.match(banner, /role="alert"/);
  assert.equal((tp.match(/role="alert"/g) || []).length, 1);
  // assertive live region 암시; 명시 aria-live 중복 없음
  assert.doesNotMatch(banner, /aria-live/);
  assert.match(
    banner,
    /onClick=\{\(\)\s*=>\s*onTriggerRelay\(session\.id\)\}[\s\S]*focus-visible:ring-2 focus-visible:ring-indigo-400/,
  );
  // 폴링마다 setSilentSession 호출하나 동일 boolean이면 React bailout → alert 노드 유지(반복 낭독 방지)
  assert.equal((tp.match(/setSilentSession\(/g) || []).length, 1);
  assert.doesNotMatch(banner, /key=\{[^}]*Date\.now|key=\{[^}]*Math\.random/);
});

test("T1793752130651_12: 안내는 재개(resumed) 세션에만, 문구에 기다리기 선택지", () => {
  const tp = read("src/components/TerminalPane.tsx");
  assert.match(tp, /setSilentSession\(!!session\.resumed &&/);
  assert.match(tp, /조금 더 기다리거나/);
  assert.match(read("src/types/types.ts"), /resumed\?: boolean/);
  const pty = read("src-tauri/src/pty.rs");
  assert.match(pty, /pub resumed: bool/);
  assert.match(pty, /resumed: resumed_cli_id\.is_some\(\)/);
});

test("T1793752130651_13: 새 세션(resumed=false)은 안내 불가, 재개는 resume_session_id 유무로 CLI 공통", () => {
  const tp = read("src/components/TerminalPane.tsx");
  // resumed 게이트가 없으면 새 세션 오탐 — 반드시 !!session.resumed &&
  assert.match(
    tp,
    /setSilentSession\(!!session\.resumed && chunk\.nextCursor === 0 && Date\.now\(\) - Date\.parse\(session\.startedAt\) > SILENT_SESSION_MS\)/,
  );
  const pty = read("src-tauri/src/pty.rs");
  assert.match(pty, /let resumed_cli_id = resume_session_id\.clone\(\)/);
  assert.match(pty, /resumed: resumed_cli_id\.is_some\(\)/);
  // CLI별 특수 분기 없이 플래그 공통(Claude/Codex/Cursor/agy 동일 게이트)
  assert.doesNotMatch(pty, /resumed:\s*cli_def\.id\s*==/);
  const main = read("src-tauri/src/main.rs");
  // managed+!start_fresh 일 때만 resume id 조회 — startFresh 새 대화는 resumed=false
  assert.match(main, /let resume_session_id = if managed && !start_fresh/);
  assert.match(main, /cli_def\.id == "claude"/);
});

test("T1793752130651_13: role=alert는 resumed 배너 1곳·폴링 bailout으로 반복 낭독 없음", () => {
  const tp = read("src/components/TerminalPane.tsx");
  const banner = tp.slice(tp.indexOf("{silentSession &&"), tp.indexOf("{silentSession &&") + 1200);
  assert.match(banner, /role="alert"/);
  assert.equal((tp.match(/role="alert"/g) || []).length, 1);
  assert.equal((tp.match(/setSilentSession\(/g) || []).length, 1);
  assert.match(banner, /조금 더 기다리거나/);
  assert.doesNotMatch(banner, /key=\{[^}]*Date\.now/);
});
