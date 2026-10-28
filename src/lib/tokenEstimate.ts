// PTY 출력 청크에서 "처음 보는 줄"의 글자 수만 센다.
// TUI는 스피너·입력창을 계속 다시 그리고, 스크롤하면 이미 본 화면을 커서 이동으로 다시 그린다.
// 커서 이동(CUP/VPA/CUU/CUD 등)을 그냥 지우면 여러 줄이 한 줄로 붙어 매번 새 줄로 세어지므로 줄바꿈으로 바꾼다.
export function countNewChars(text: string, seen: Set<string>): number {
  const plain = text
    .replace(/\x1b\[[0-9;?]*[HfdABEFG]/g, "\n") // 커서 위치/상하 이동 → 줄 경계
    .replace(/\x1b\[[0-9;]*C/g, " ") // 커서 오른쪽 이동 → 공백
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g, "");
  let newChars = 0;
  for (const line of plain.split(/[\r\n]+/)) {
    // 숫자만 바뀐 줄(경과 시간·카운터)과 TUI 테두리 문자 차이는 같은 줄로 본다
    const key = line.replace(/\d+/g, "#").replace(/[│┃|╭╮╰╯─━]/g, "").replace(/\s+/g, " ").trim();
    if (key.length < 2 || seen.has(key)) continue;
    seen.add(key);
    newChars += key.length;
  }
  // ponytail: 줄 캐시 상한 5000개, 넘으면 비우고 다시 셈 (추정치가 조금 늘 수 있음)
  if (seen.size > 5000) seen.clear();
  return newChars;
}
