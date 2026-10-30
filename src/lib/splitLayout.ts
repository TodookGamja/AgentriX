export type SplitLayout = "single" | "split-h" | "split-v" | "grid-4";

export const LAYOUT_CYCLE = ["single", "split-h", "split-v", "grid-4"] as const;

export function nextSplitLayout(current: SplitLayout): SplitLayout {
  const curIdx = LAYOUT_CYCLE.indexOf(current);
  const idx = curIdx < 0 ? 0 : (curIdx + 1) % LAYOUT_CYCLE.length;
  return LAYOUT_CYCLE[idx];
}

export function visibleSlotCount(layout: SplitLayout): number {
  return layout === "single" ? 1 : layout === "grid-4" ? 4 : 2;
}

/** 분할 모드에서 슬롯 배치를 고정한다. 포커스 이동으로 자리바꿈이 생기지 않게 한다. */
export function resolvePaneSessions<T extends { id: string }>(opts: {
  layout: SplitLayout;
  sessions: T[];
  projectSessions: T[];
  activeSessionId: string | null;
  splitSlotSessionIds: (string | null)[];
}): (T | null)[] {
  const { layout, sessions, projectSessions, activeSessionId, splitSlotSessionIds } = opts;
  if (layout === "single") {
    const active =
      sessions.find((s) => s.id === activeSessionId) ||
      projectSessions[0] ||
      sessions[0] ||
      null;
    return [active, null, null, null];
  }

  const assigned: (T | null)[] = [];
  const usedIds = new Set<string>();
  for (let slot = 0; slot < 4; slot++) {
    const preferredId = splitSlotSessionIds[slot];
    const preferred = preferredId
      ? sessions.find((s) => s.id === preferredId && !usedIds.has(s.id))
      : null;
    if (preferred) {
      assigned.push(preferred);
      usedIds.add(preferred.id);
      continue;
    }
    const candidate =
      projectSessions.find((s) => !usedIds.has(s.id)) ||
      sessions.find((s) => !usedIds.has(s.id)) ||
      null;
    if (candidate) {
      assigned.push(candidate);
      usedIds.add(candidate.id);
    } else {
      assigned.push(null);
    }
  }
  return assigned;
}
