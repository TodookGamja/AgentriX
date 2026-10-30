// 완료 열: 작업표는 아래 행이 최근이므로 뒤집어 최신순으로 두고, 기본은 앞 limit개만 보여준다
export function recentDone<T>(items: T[], expanded: boolean, limit = 5): { shown: T[]; hidden: number } {
  const ordered = [...items].reverse();
  if (expanded || ordered.length <= limit) return { shown: ordered, hidden: 0 };
  return { shown: ordered.slice(0, limit), hidden: ordered.length - limit };
}

// 패널 아래 끝이 창 안(margin 여백)에 들어오도록 헤더 버튼 하단 기준 최대 높이를 계산
export function panelMaxHeight(innerHeight: number, anchorBottom: number, gap = 8, margin = 16, min = 240): number {
  return Math.max(min, Math.floor(innerHeight - anchorBottom - gap - margin));
}
