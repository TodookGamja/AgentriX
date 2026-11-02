export type MiniQuotaSnapshot = {
  cliId: string;
  cliName: string;
  planLabel: string;
  accentColor: string;
  remainPct5h: number;
  remainPctWeekly: number;
  resetsAt5h: string | null;
  resetsAtWeekly: string | null;
  /** 저장 시각(ms). 시각만 있는 리셋 문자열("HH:mm")의 날짜 기준 */
  savedAt?: number;
};

/** 백엔드 format_epoch_kst/format_iso_kst 출력("HH:mm" | "MM/DD HH:mm", KST)을 epoch ms로. 해석 불가면 null */
export function parseKstReset(str: string | null, savedAt: number): number | null {
  const m = str?.match(/(?:(\d{1,2})\/(\d{1,2})\s+)?(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const base = new Date(savedAt + 9 * 3600_000); // KST 벽시계를 UTC 필드로 읽음
  const p = (n: number) => String(n).padStart(2, "0");
  const mo = m[1] ? +m[1] : base.getUTCMonth() + 1;
  const d = m[2] ? +m[2] : base.getUTCDate();
  let t = Date.parse(`${base.getUTCFullYear()}-${p(mo)}-${p(d)}T${p(+m[3])}:${m[4]}:00+09:00`);
  // ponytail: 연말→연초 리셋은 저장 시각보다 과거로 나오면 +1년으로만 보정
  if (m[1] && t < savedAt - 86400_000) t = Date.parse(`${base.getUTCFullYear() + 1}-${p(mo)}-${p(d)}T${p(+m[3])}:${m[4]}:00+09:00`);
  return t;
}

/** 리셋 시각이 지난 창은 잔여 100%·리셋 없음으로 보정. savedAt 없는(구버전) 캐시는 판정 불가라 null */
export function normalizeMiniQuota(s: MiniQuotaSnapshot, now = Date.now()): MiniQuotaSnapshot | null {
  if (!s.savedAt) return null;
  const expired = (r: string | null) => {
    const t = parseKstReset(r, s.savedAt!);
    return t !== null && t <= now;
  };
  const e5 = expired(s.resetsAt5h);
  const eW = expired(s.resetsAtWeekly);
  return {
    ...s,
    remainPct5h: e5 ? 100 : s.remainPct5h,
    resetsAt5h: e5 ? null : s.resetsAt5h,
    remainPctWeekly: eW ? 100 : s.remainPctWeekly,
    resetsAtWeekly: eW ? null : s.resetsAtWeekly,
  };
}

/** 하드코딩 더미 시각("13:50")이 섞인 캐시는 폐기 */
export function parseMiniQuotaCache(raw: string | null): MiniQuotaSnapshot | null {
  if (!raw || raw.includes("13:50")) return null;
  try {
    const parsed = JSON.parse(raw) as MiniQuotaSnapshot;
    if (!parsed || typeof parsed.cliId !== "string") return null;
    return normalizeMiniQuota(parsed);
  } catch {
    return null;
  }
}

export function restoreMiniQuotaCache(
  getItem: (key: string) => string | null,
  focusedCliId: string
): MiniQuotaSnapshot | null {
  const perCli = parseMiniQuotaCache(getItem(`agentrix_mini_quota_${focusedCliId}`));
  if (perCli?.cliId === focusedCliId) return perCli;
  const global = parseMiniQuotaCache(getItem("agentrix_mini_quota_cached"));
  return global?.cliId === focusedCliId ? global : null;
}

/** 공식 쿼터 또는 리셋 시각이 있을 때만 라이브 값을 채택 (더미 100% 배제) */
export function isLiveQuotaUsable(quota: {
  hasOfficialQuota?: boolean;
  resetsAt5h?: string | null;
} | null | undefined): boolean {
  return Boolean(quota && (quota.hasOfficialQuota || quota.resetsAt5h));
}

export function persistMiniQuotaCache(
  setItem: (key: string, value: string) => void,
  snapshot: MiniQuotaSnapshot
): void {
  const raw = JSON.stringify({ ...snapshot, savedAt: snapshot.savedAt ?? Date.now() });
  setItem("agentrix_mini_quota_cached", raw);
  setItem(`agentrix_mini_quota_${snapshot.cliId}`, raw);
}
