// 브라우저 기본 confirm/alert 대신 앱 안 모달(ConfirmHost)을 여는 Promise API.
export type ConfirmRequest = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean; // 위험 동작: 확인 버튼 붉게, 기본 포커스는 취소
  infoOnly?: boolean; // 알림용: 확인 버튼만
  resolve: (ok: boolean) => void;
};

let listener: ((r: ConfirmRequest) => void) | null = null;
export const confirmDialogSubscribe = (fn: (r: ConfirmRequest) => void) => {
  listener = fn;
  return () => { if (listener === fn) listener = null; };
};

// 모달이 아직 마운트되지 않았으면 취소(false)로 안전하게 끝낸다.
// 열려 있는(대기 포함) 모달 수 — 전역 단축키가 모달 뒤에서 동작하지 않게 App·TerminalPane이 확인한다.
let openCount = 0;
export const isConfirmOpen = () => openCount > 0;
export const confirmDialog = (opts: Omit<ConfirmRequest, "resolve">): Promise<boolean> =>
  new Promise((resolve) => {
    if (!listener) return resolve(false);
    openCount++;
    listener({ ...opts, resolve: (ok) => { openCount--; resolve(ok); } });
  });
export const alertDialog = (title: string, message?: string): Promise<boolean> =>
  confirmDialog({ title, message, infoOnly: true });
