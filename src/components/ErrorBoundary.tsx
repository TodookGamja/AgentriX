import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-950 text-slate-100 select-text">
        <div className="max-w-lg w-full mx-4 rounded-xl border border-slate-800 bg-slate-900 p-6 space-y-4">
          <h1 className="text-lg font-semibold">화면을 표시하는 중 문제가 발생했습니다</h1>
          <p className="text-sm text-slate-400">
            새로고침 시 터미널 화면이 재설정됩니다. 작업 중이던 명령은 재시작이 필요할 수 있습니다. 반복되면 아래 오류를 개발팀에 전달해 주세요.
          </p>
          <pre className="max-h-40 overflow-auto rounded-lg border border-rose-500/20 bg-slate-950/80 p-3 font-mono text-[11px] text-rose-400 whitespace-pre-wrap">
            {error.message}
          </pre>
          <div className="flex gap-2">
            <button
              onClick={() => window.location.reload()}
              className="rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              새로고침
            </button>
            <button
              onClick={() => this.setState({ error: null })}
              className="rounded-lg border border-slate-700 hover:bg-slate-800 px-4 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }
}
