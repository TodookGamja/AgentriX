// xterm.js가 출력 속 질의(ESC[6n 등)에 자동으로 보내는 응답인지 판정.
// 재마운트 시 버퍼 재생 중 이 응답이 PTY로 가면 cursor는 `[1;1R`을 글자로 쌓고,
// codex는 Windows ConPTY가 `CSI 1;1 R`을 F3로 해석해 Find 모드가 열린다.
export function isTerminalReport(data: string): boolean {
  return /^(?:\x1b\[[?>]?[\d;]*[Rcn])+$/.test(data);
}

// 화면 전환 중 일시적으로 찌그러진 크기나 같은 크기를 PTY로 보내지 않는다 (CLI가 다른 폭으로 다시 그려 화면이 깨짐)
export function shouldResizePty(
  prev: { cols: number; rows: number } | null,
  next: { cols: number; rows: number }
): boolean {
  if (next.cols < 20 || next.rows < 5) return false;
  return !prev || prev.cols !== next.cols || prev.rows !== next.rows;
}
