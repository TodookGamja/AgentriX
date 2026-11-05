import { invoke } from "@tauri-apps/api/core";

export class DeliveryAttempt {
  readonly startedAt = Date.now();
  cancelled = false;
  committed = false;
  stage = "lock";
  private cancel!: () => void;
  readonly cancelledPromise = new Promise<void>((resolve) => { this.cancel = resolve; });

  constructor(readonly sessionId: string, readonly id: string) { this.step("lock"); }

  step(stage: string, source?: string): void {
    this.stage = stage;
    void invoke("log_delivery_stage", { sessionId: this.sessionId, attemptId: this.id, stage, elapsedMs: Date.now() - this.startedAt, source }).catch(() => {});
  }

  check(): void {
    if (this.cancelled) throw new Error("delivery attempt cancelled");
  }

  commit(): void {
    this.check();
    this.committed = true;
    this.step("write");
  }

  abort(): void {
    this.cancelled = true;
    this.cancel();
  }
}

export async function withDeliveryDeadline<T>(attempt: DeliveryAttempt, operation: () => Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          attempt.abort();
          reject(new Error(`delivery timeout at ${attempt.stage}`));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
