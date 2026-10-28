import assert from "node:assert/strict";
import { getSessionInputHistory, recordSessionInput, setInstructionKeyResolver } from "../src/lib/inputHistory.ts";

// 세션 a(원래 세션)와 b(릴레이·재시작 후 새 세션)는 같은 프로젝트의 같은 에이전트
setInstructionKeyResolver((id) => (id === "a" || id === "b" ? "C:/proj|agent-1" : id));

// 사용자가 한 글자씩 입력 + 백스페이스 + 방향키
for (const ch of ["l", "o", "g", "x", "\x7f", "i", "n", " ", "기", "능", "\x1b[A", "\r"]) recordSessionInput("a", ch);
// 프로그램 주입(텍스트+\r), 붙여넣기 마커 포함
recordSessionInput("a", "\x1b[200~T2 작업을 수행하세요\x1b[201~\r");
// 지시가 아닌 입력은 제외
recordSessionInput("a", "y\r");
recordSessionInput("a", "/compact\r");
assert.deepEqual(getSessionInputHistory("a"), ["login 기능", "T2 작업을 수행하세요"]);

// 새 세션은 같은 에이전트 키라 이전 지시를 그대로 보고, 이어서 쌓는다
recordSessionInput("b", "SESSION_HANDOFF.md를 읽으세요\r");
assert.deepEqual(getSessionInputHistory("b"), ["login 기능", "T2 작업을 수행하세요", "SESSION_HANDOFF.md를 읽으세요"]);
// 다른 에이전트와는 섞이지 않음
assert.deepEqual(getSessionInputHistory("c"), []);
console.log("input history ok");
