// 실행: node scripts/miniQuotaCache.check.ts (Node 22.6+ --experimental-strip-types)
import { normalizeMiniQuota, type MiniQuotaSnapshot } from "../src/lib/miniQuotaCache.ts";
import assert from "node:assert";
const A = (c: boolean, m: string) => assert.ok(c, m);
  const kst = (iso: string) => Date.parse(iso);
  const base: MiniQuotaSnapshot = { cliId: "claude", cliName: "c", planLabel: "p", accentColor: "#000",
    remainPct5h: 10, remainPctWeekly: 20, resetsAt5h: "15:00", resetsAtWeekly: "11/05 09:00", savedAt: kst("2026-11-02T12:00:00+09:00") };
  const before = normalizeMiniQuota(base, kst("2026-11-02T14:00:00+09:00"))!;
  A(before.remainPct5h === 10 && before.remainPctWeekly === 20, "리셋 전엔 유지");
  const mid = normalizeMiniQuota(base, kst("2026-11-02T15:01:00+09:00"))!;
  A(mid.remainPct5h === 100 && mid.resetsAt5h === null && mid.remainPctWeekly === 20, "5h만 복귀");
  const after = normalizeMiniQuota(base, kst("2026-11-05T09:01:00+09:00"))!;
  A(after.remainPctWeekly === 100 && after.resetsAtWeekly === null, "주간 복귀");
  A(normalizeMiniQuota({ ...base, savedAt: undefined }) === null, "savedAt 없으면 폐기");
  console.log("ok");
