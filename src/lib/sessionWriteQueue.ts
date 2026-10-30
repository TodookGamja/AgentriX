const tails = new Map<string, Promise<void>>();

export function queueSessionWrite(sessionId: string, write: () => Promise<void>): Promise<void> {
  const previous = tails.get(sessionId) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(write);
  tails.set(sessionId, next);
  void next.finally(() => {
    if (tails.get(sessionId) === next) tails.delete(sessionId);
  }).catch(() => {});
  return next;
}
