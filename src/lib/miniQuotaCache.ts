export type MiniQuotaSnapshot = {
  cliId: string;
  cliName: string;
  planLabel: string;
  accentColor: string;
  remainPct5h: number;
  remainPctWeekly: number;
  resetsAt5h: string | null;
  resetsAtWeekly: string | null;
};

/** 하드코딩 더미 시각("13:50")이 섞인 캐시는 폐기 */
export function parseMiniQuotaCache(raw: string | null): MiniQuotaSnapshot | null {
  if (!raw || raw.includes("13:50")) return null;
  try {
    const parsed = JSON.parse(raw) as MiniQuotaSnapshot;
    if (!parsed || typeof parsed.cliId !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function restoreMiniQuotaCache(
  getItem: (key: string) => string | null,
  focusedCliId: string
): MiniQuotaSnapshot | null {
  const perCli = parseMiniQuotaCache(getItem(`agentrix_mini_quota_${focusedCliId}`));
  if (perCli) return perCli;
  return parseMiniQuotaCache(getItem("agentrix_mini_quota_cached"));
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
  const raw = JSON.stringify(snapshot);
  setItem("agentrix_mini_quota_cached", raw);
  setItem(`agentrix_mini_quota_${snapshot.cliId}`, raw);
}
