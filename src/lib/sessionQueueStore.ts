import { create } from "zustand";
import { persist } from "zustand/middleware";
import { dropStaleAuto, moveItem, removeItem, upsertItem, type QueueItem, type QueueMap } from "./sessionQueue";

interface SessionQueueState {
  queues: QueueMap;
  upsert: (sid: string, item: QueueItem) => void;
  remove: (sid: string, id: string) => void;
  move: (sid: string, id: string, dir: -1 | 1) => void;
  dropStale: (isFresh: (key: string, id: string) => boolean) => void;
  resolved: Set<string>; // 사용자가 직접 보내거나 버린 자동 항목(key|id). 게이트가 한 번 소비해 "처리됨"으로 넘긴다
  resolve: (sid: string, id: string) => void;
}

// 키 = agentId(없으면 sessionId): 재출근으로 세션 ID가 바뀌어도 사용자 항목이 이어진다
export const queueKey = (s: { agentId?: string | null; id: string }) => s.agentId || s.id;

// 앱을 다시 켜도 대기 항목 유지(localStorage)
export const useSessionQueue = create<SessionQueueState>()(
  persist(
    (set) => ({
      queues: {},
      resolved: new Set<string>(),
      resolve: (sid, id) => set((s) => ({ queues: removeItem(s.queues, sid, id), resolved: new Set(s.resolved).add(`${sid}|${id}`) })),
      upsert: (sid, item) => set((s) => { const q = upsertItem(s.queues, sid, item); return q === s.queues ? s : { queues: q }; }),
      remove: (sid, id) => set((s) => { const q = removeItem(s.queues, sid, id); return q === s.queues ? s : { queues: q }; }),
      move: (sid, id, dir) => set((s) => { const q = moveItem(s.queues, sid, id, dir); return q === s.queues ? s : { queues: q }; }),
      dropStale: (isFresh) => set((s) => { const q = dropStaleAuto(s.queues, isFresh); return q === s.queues ? s : { queues: q }; }),
    }),
    { name: "agentrix_session_queue", partialize: (s) => ({ queues: s.queues }) }
  )
);
