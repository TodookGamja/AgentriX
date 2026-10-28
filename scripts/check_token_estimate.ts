import assert from "node:assert/strict";
import { countNewChars } from "../src/lib/tokenEstimate.ts";

const seen = new Set<string>();
// 처음 그린 화면: 커서 위치 지정으로 줄을 배치 (줄바꿈 없음)
const screen = "\x1b[1;1H함수 divide 추가\x1b[2;1H테스트 통과\x1b[3;1H│ > 입력창 │";
const first = countNewChars(screen, seen);
assert.ok(first > 0);
// 스크롤로 같은 내용을 다른 행 위치에 다시 그림 → 새로 셀 게 없어야 함
assert.equal(countNewChars("\x1b[2J\x1b[5;1H함수 divide 추가\x1b[6;1H테스트 통과\x1b[7;1H│ > 입력창 │", seen), 0);
// 스피너 경과 시간만 바뀜 → 0
countNewChars("\x1b[9;1H✻ Working… (12s)", seen);
assert.equal(countNewChars("\x1b[9;1H✻ Working… (13s)", seen), 0);
// 진짜 새 출력은 센다
assert.ok(countNewChars("\x1b[10;1H새로운 응답 줄", seen) > 0);
console.log("token estimate ok");
