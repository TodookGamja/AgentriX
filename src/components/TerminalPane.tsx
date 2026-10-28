import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  CornerDownLeft,
  FolderOpen,
  Image as ImageIcon,
  LogIn,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Square,
  TerminalSquare,
  X,
  Zap,
} from "lucide-react";
import type { CliDefinition, SessionInfo } from "../types/types";
import {
  apiReadSessionOutput,
  apiResizeSession,
  apiSaveClipboardImage,
  apiWriteToSession,
} from "../lib/tauriBridge";
import { FilePickerModal } from "./FilePickerModal";

interface TerminalPaneProps {
  session: SessionInfo;
  cliDef?: CliDefinition;
  isVisible: boolean;
  isFocused?: boolean;
  splitActive?: boolean;
  projectAgentCount?: number;
  estimatedTokens?: number;
  contextThresholdTokens?: number;
  onBroadcastPrompt?: (text: string) => Promise<void>;
  onBroadcastToProject?: (projectPath: string, text: string) => Promise<void>;
  onActivity?: () => void;
  onOutputChunk?: (sessionId: string, text: string) => void;
  onOpenTokenOptimization?: () => void;
  onTriggerRelay?: (sessionId: string) => void;
}

const QUICK_COMMANDS = [
  { label: "/compact", cmd: "/compact", desc: "컨텍스트 압축" },
  { label: "/status", cmd: "/status", desc: "세션 상태 확인" },
  { label: "/model", cmd: "/model", desc: "모델 전환" },
  { label: "/cost", cmd: "/cost", desc: "토큰/비용 확인" },
  { label: "/clear", cmd: "/clear", desc: "대화 초기화" },
];

export const TerminalPane: React.FC<TerminalPaneProps> = ({
  session,
  cliDef,
  isVisible,
  isFocused = false,
  splitActive = false,
  projectAgentCount = 1,
  estimatedTokens = 0,
  contextThresholdTokens = 100000,
  onBroadcastPrompt,
  onBroadcastToProject,
  onActivity,
  onOutputChunk,
  onOpenTokenOptimization,
  onTriggerRelay,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 폴링 루프는 마운트 시 한 번만 만들어지므로 최신 콜백을 ref로 참조 (stale closure 방지)
  const onOutputChunkRef = useRef(onOutputChunk);
  onOutputChunkRef.current = onOutputChunk;
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cursorRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<string[]>([]);

  // 채팅창 높이 (상단 핸들 드래그로 조절, localStorage 저장)
  const [chatHeight, setChatHeight] = useState<number>(
    () => Number(localStorage.getItem("agentrix_chat_height")) || 150
  );
  useEffect(() => {
    localStorage.setItem("agentrix_chat_height", String(chatHeight));
  }, [chatHeight]);

  const startChatResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = chatHeight;
    const onMove = (ev: MouseEvent) =>
      setChatHeight(Math.round(Math.max(110, Math.min(window.innerHeight * 0.7, startH + startY - ev.clientY))));
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // 하단 전용 채팅창 상태
  const [promptText, setPromptText] = useState("");
  const [broadcastToSplit, setBroadcastToSplit] = useState(false);
  const [broadcastToProject, setBroadcastToProject] = useState(false);
  const [promptHistory, setPromptHistory] = useState<string[]>([]);
  const [historyIdx, setHistoryIdx] = useState<number>(-1);

  // 실시간 폰트 크기 조절 (Ctrl + 휠 줌 및 Ctrl + +/- 지원)
  const [fontSize, setFontSize] = useState<number>(() => {
    try {
      const v = localStorage.getItem("agentrix_term_font_size");
      if (v) return parseFloat(v);
    } catch {}
    return 13.5;
  });

  const changeFontSize = (delta: number) => {
    setFontSize((prev) => {
      const next = Math.max(10, Math.min(26, Math.round((prev + delta) * 10) / 10));
      try {
        localStorage.setItem("agentrix_term_font_size", next.toString());
      } catch {}
      if (termRef.current) {
        termRef.current.options.fontSize = next;
        setTimeout(() => fitAddonRef.current?.fit(), 10);
      }
      return next;
    });
  };

  const resetFontSize = () => {
    setFontSize(13.5);
    try {
      localStorage.setItem("agentrix_term_font_size", "13.5");
    } catch {}
    if (termRef.current) {
      termRef.current.options.fontSize = 13.5;
      setTimeout(() => fitAddonRef.current?.fit(), 10);
    }
  };

  // 첨부 파일은 채팅창 위 칩으로 보관했다가 전송 시 경로로 함께 보낸다
  const addAttachments = (paths: string[]) =>
    setAttachments((prev) => [...prev, ...paths.filter((p) => p && !prev.includes(p))]);

  // 실제 경로가 없는 파일(클립보드/네이티브 선택)은 프로젝트 .attachments에 저장 후 첨부
  const attachFiles = async (files: FileList | File[]) => {
    try {
      const paths = await Promise.all(
        Array.from(files).map(async (f) => {
          const p = (f as any).path as string | undefined;
          if (p) return p;
          const b64 = await new Promise<string>((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result as string);
            r.onerror = rej;
            r.readAsDataURL(f);
          });
          const ext = f.name.includes(".") ? f.name.split(".").pop()! : f.type.split("/")[1] || "png";
          return apiSaveClipboardImage(b64, session.cwd, ext);
        })
      );
      addAttachments(paths);
    } catch (err) {
      console.error("파일 첨부 실패:", err);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) await attachFiles(e.target.files);
    e.target.value = "";
  };

  // 탐색기에서 끌어다 놓은 파일: Tauri 네이티브 드롭 이벤트로 실제 경로를 받아 이 패널 위에 놓였을 때만 첨부
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!isVisible) return;
    const inside = (pos: { x: number; y: number }) => {
      const r = rootRef.current?.getBoundingClientRect();
      if (!r || r.width === 0) return false;
      const x = pos.x / window.devicePixelRatio;
      const y = pos.y / window.devicePixelRatio;
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    };
    let unlisten: (() => void) | undefined;
    getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") return setIsDraggingOver(false);
        const over = inside(payload.position);
        if (payload.type === "drop") {
          setIsDraggingOver(false);
          if (over) addAttachments(payload.paths);
        } else {
          setIsDraggingOver(over);
        }
      })
      .then((u) => (unlisten = u))
      .catch(() => {});
    return () => unlisten?.();
  }, [isVisible]);

  // 포커스 진입 시 xterm 자동 포커스
  useEffect(() => {
    if (isFocused && termRef.current) {
      termRef.current.focus();
    }
  }, [isFocused]);

  // 전역 키보드 캡처 리스너: 포커스 위치와 무관하게 Ctrl+0(원상복구), Ctrl++(확대), Ctrl--(축소) 100% 작동 보장
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      if (e.ctrlKey) {
        // 숫자 0, 넘패드 0 리셋
        if (e.key === "0" || e.code === "Digit0" || e.code === "Numpad0") {
          e.preventDefault();
          e.stopImmediatePropagation();
          resetFontSize();
        } else if (
          e.key === "=" ||
          e.key === "+" ||
          e.code === "Equal" ||
          e.code === "NumpadAdd"
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          changeFontSize(1);
        } else if (
          e.key === "-" ||
          e.code === "Minus" ||
          e.code === "NumpadSubtract"
        ) {
          e.preventDefault();
          e.stopImmediatePropagation();
          changeFontSize(-1);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [isVisible]);

  // 휠 이벤트 캡처: capture: true로 xterm 내부 자식의 이벤트 흡수를 원천 우회
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.deltaY < 0) {
          changeFontSize(1);
        } else if (e.deltaY > 0) {
          changeFontSize(-1);
        }
      }
    };

    container.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => {
      container.removeEventListener("wheel", onWheel, { capture: true });
    };
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: "block",
      fontSize: fontSize,
      lineHeight: 1.28,
      fontFamily: '"JetBrains Mono", Consolas, "Malgun Gothic", monospace',
      scrollback: 5000,
      allowProposedApi: true,
      // ConPTY가 직접 줄바꿈·재배치하므로 xterm 리플로우와 충돌하지 않게 알려준다 (스크롤 후 화면 깨짐 방지)
      windowsPty: navigator.userAgent.includes("Windows") ? { backend: "conpty", buildNumber: 22000 } : undefined,
      theme: {
        background: "#090d16",
        foreground: "#e2e8f0",
        cursor: "#818cf8",
        cursorAccent: "#090d16",
        selectionBackground: "rgba(99, 102, 241, 0.32)",
        black: "#1e293b",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#f1f5f9",
        brightBlack: "#475569",
        brightRed: "#fca5a5",
        brightGreen: "#6ee7b7",
        brightYellow: "#fde68a",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#ffffff",
      },
    });

    // Ctrl + +/-/0 키보드 단축키를 xterm이 씹지 않고 폰트 조절로 처리
    term.attachCustomKeyEventHandler((e) => {
      if (e.ctrlKey && (e.key === "=" || e.key === "+" || e.key === "-" || e.key === "0")) {
        if (e.type === "keydown") {
          if (e.key === "=" || e.key === "+") changeFontSize(1);
          else if (e.key === "-") changeFontSize(-1);
          else if (e.key === "0") resetFontSize();
        }
        return false;
      }
      return true;
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(container);

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    // 재마운트 시 버퍼 재생이 기본 80열로 그려져 줄이 겹치지 않도록, 보이는 상태면 재생 전에 크기부터 맞춘다.
    if (container.clientWidth > 0) {
      try {
        fitAddon.fit();
      } catch {}
    }

    const dataDisposable = term.onData((data) => {
      apiWriteToSession(session.id, data).catch(console.error);
      if (data.includes("\r") && onActivity) {
        onActivity();
      }
    });

    let active = true;
    // 마운트 직후 첫 청크는 기존 버퍼 재생일 수 있으므로 토큰 추정에서 제외 (화면 이동 시 재집계 → 불필요한 /compact 방지)
    let replayed = false;
    // 이전 요청이 끝나기 전에 다음 폴링이 겹치면 같은 커서로 두 번 읽어 출력이 중복/역순으로 써진다
    let inFlight = false;
    const pollInterval = window.setInterval(async () => {
      if (!active || inFlight) return;
      inFlight = true;
      try {
        const chunk = await apiReadSessionOutput(session.id, cursorRef.current);
        cursorRef.current = chunk.nextCursor;
        if (chunk.data && chunk.data.length > 0) {
          // 스크롤을 강제로 내리지 않는다: 맨 아래에 있으면 xterm이 알아서 따라가고, 위로 올려 둔 경우엔 그대로 둔다.
          term.write(chunk.data);
          if (replayed) onOutputChunkRef.current?.(session.id, chunk.data);
          replayed = true;
        }
      } catch {
        // 세션 종료 시 무시
      } finally {
        inFlight = false;
      }
    }, 55);

    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || containerRef.current.clientWidth === 0) {
        return;
      }
      try {
        fitAddon.fit();
        if (term.cols > 0 && term.rows > 0) {
          apiResizeSession(session.id, term.cols, term.rows).catch(() => {});
        }
      } catch {
        // ignore layout transition
      }
    });
    resizeObserver.observe(container);

    // 클립보드 이미지 / 파일 붙여넣기 (Ctrl + V) 핸들러
    // 터미널에 붙여넣은 파일/이미지도 바로 입력하지 않고 채팅창 첨부로 보낸다
    const handlePaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      e.stopPropagation();
      attachFiles(files);
    };

    container.addEventListener("paste", handlePaste);

    setTimeout(() => {
      // 숨김(hidden) 상태로 마운트된 경우 PTY를 기본 80x24로 줄이지 않는다 (CLI가 좁은 폭으로 다시 그려 줄이 늘어남)
      if (!containerRef.current || containerRef.current.clientWidth === 0) return;
      try {
        fitAddon.fit();
        if (term.cols > 0 && term.rows > 0) {
          apiResizeSession(session.id, term.cols, term.rows).catch(() => {});
        }
      } catch {
        // ignore
      }
    }, 80);

    return () => {
      active = false;
      window.clearInterval(pollInterval);
      resizeObserver.disconnect();
      container.removeEventListener("paste", handlePaste);
      dataDisposable.dispose();
      term.dispose();
    };
  }, [session.id]);

  // 탭 전환 또는 레이아웃 리사이즈 시 크기 재맞춤
  useEffect(() => {
    if (isVisible && fitAddonRef.current && termRef.current) {
      const timer = setTimeout(() => {
        try {
          fitAddonRef.current?.fit();
          const cols = termRef.current?.cols ?? 100;
          const rows = termRef.current?.rows ?? 30;
          apiResizeSession(session.id, cols, rows).catch(() => {});
        } catch {
          // ignore
        }
      }, 40);
      return () => clearTimeout(timer);
    }
  }, [isVisible, session.id]);

  const sendRawCommand = (cmd: string) => {
    apiWriteToSession(session.id, `${cmd}\r`).catch(console.error);
    termRef.current?.scrollToBottom();
    termRef.current?.focus();
    if (onActivity) onActivity();
  };

  const handleInjectRoleBriefing = async () => {
    if (!session.rolePrompt) return;
    const fName =
      session.cwd?.split(/[/\\]/).filter(Boolean).pop() || session.cwd;
    const briefing = `[프로젝트 '${fName}' 에이전트 역할 부여] 당신은 '${session.agentName ?? session.name}' (${session.agentRole ?? "전담 에이전트"})입니다. 지침: ${session.rolePrompt} (.ai-agents/agents/${session.agentId}/ROLE.md 및 .ai-agents/BLACKBOARD.md 파일을 함께 참고하여 이 프로젝트 범위 내에서만 임무를 수행하세요.)\r`;
    await apiWriteToSession(session.id, briefing);
    termRef.current?.scrollToBottom();
    termRef.current?.focus();
    if (onActivity) onActivity();
  };

  const handleSendChatPrompt = async () => {
    const trimmed = promptText.trim();
    const message = [...attachments.map((p) => `"${p}"`), trimmed].filter(Boolean).join(" ");
    if (!message) {
      await apiWriteToSession(session.id, "\r");
      termRef.current?.scrollToBottom();
      termRef.current?.focus();
      return;
    }

    if (broadcastToProject && onBroadcastToProject) {
      await onBroadcastToProject(session.cwd, `${message}\r`);
    } else if (broadcastToSplit && splitActive && onBroadcastPrompt) {
      await onBroadcastPrompt(`${message}\r`);
    } else {
      await apiWriteToSession(session.id, `${message}\r`);
    }

    if (trimmed) setPromptHistory((prev) => [trimmed, ...prev.slice(0, 29)]);
    setAttachments([]);
    setHistoryIdx(-1);
    setPromptText("");
    termRef.current?.scrollToBottom();
    termRef.current?.focus();
    if (onActivity) onActivity();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendChatPrompt();
    } else if (e.key === "ArrowUp" && !promptText.includes("\n")) {
      if (promptHistory.length > 0 && historyIdx + 1 < promptHistory.length) {
        e.preventDefault();
        const nextIdx = historyIdx + 1;
        setHistoryIdx(nextIdx);
        setPromptText(promptHistory[nextIdx]);
      }
    } else if (e.key === "ArrowDown" && !promptText.includes("\n")) {
      if (historyIdx > 0) {
        e.preventDefault();
        const nextIdx = historyIdx - 1;
        setHistoryIdx(nextIdx);
        setPromptText(promptHistory[nextIdx]);
      } else if (historyIdx === 0) {
        e.preventDefault();
        setHistoryIdx(-1);
        setPromptText("");
      }
    }
  };

  const folderName =
    session.cwd?.split(/[/\\]/).filter(Boolean).pop() || session.cwd;

  return (
    <div ref={rootRef} className="flex flex-col w-full h-full bg-[#090d16] border border-slate-800/80 rounded-xl overflow-hidden">
      {/* 1. 상단 세션 헤더 바 (절대 줄바꿈/찌그러짐 없도록 whitespace-nowrap & shrink-0 적용) */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-900/95 border-b border-slate-800/80 text-xs overflow-x-auto no-scrollbar shrink-0">
        {/* 프로젝트 + 역할만 표시 (세부 정보는 마우스 오버) */}
        <div className="flex items-center gap-2 min-w-0">
          <TerminalSquare
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: cliDef?.accentColor ?? "#818cf8" }}
          />
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[11px] font-semibold whitespace-nowrap shrink-0"
            title={`작업 프로젝트 폴더: ${session.cwd}`}
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            {folderName}
          </span>
          <span
            className="font-semibold text-slate-100 truncate"
            title={session.rolePrompt ?? session.agentRole ?? session.name}
          >
            {session.agentRole || session.name}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {session.rolePrompt && (
            <button
              onClick={handleInjectRoleBriefing}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-fuchsia-600/80 hover:bg-fuchsia-500 text-white font-semibold transition text-[11px] whitespace-nowrap shrink-0 shadow"
              title="이 프로젝트에 설정된 에이전트 전담 역할 지침(Role Briefing)을 터미널에 즉시 주입합니다"
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              역할 주입
            </button>
          )}
          {/* 토큰 사용량 & 스마트 인수인계 릴레이 버튼 */}
          <button
            onClick={onOpenTokenOptimization}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border transition text-[11px] font-bold whitespace-nowrap shrink-0 shadow-sm ${
              estimatedTokens >= (contextThresholdTokens || 100000) * 0.85
                ? "bg-amber-100 text-amber-950 border-amber-400 hover:bg-amber-200 dark:bg-amber-500/20 dark:text-amber-300 dark:border-amber-500/50 dark:hover:bg-amber-500/30 animate-pulse font-extrabold"
                : "bg-slate-900 text-slate-200 border-slate-800 hover:bg-slate-800 hover:text-slate-100"
            }`}
            title={`컨텍스트 토큰 최적화 설정 (현재 약 ${Math.round(estimatedTokens / 1000)}k / 한도 ${Math.round((contextThresholdTokens || 100000) / 1000)}k 토큰)`}
          >
            <Zap className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
            <span className="font-extrabold text-slate-900 dark:text-slate-100">~{Math.round(estimatedTokens / 1000)}k</span>
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-400">/{Math.round((contextThresholdTokens || 100000) / 1000)}k</span>
          </button>

          {onTriggerRelay && (
            <button
              onClick={() => onTriggerRelay(session.id)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white font-medium transition text-[11px] whitespace-nowrap shrink-0 shadow"
              title="이전 작업 맥락을 보존하며 다음 세션으로 즉시 인수인계(릴레이)합니다"
            >
              <RefreshCw className="w-3 h-3 shrink-0" />
              릴레이
            </button>
          )}

          <button
            onClick={() => apiWriteToSession(session.id, "\x03")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition text-[11px] whitespace-nowrap shrink-0"
            title="Ctrl+C (실행 중단 신호 전송)"
          >
            <Square className="w-2.5 h-2.5 fill-current shrink-0" />
            중단
          </button>
          {/* 폰트 크기 조절 컨트롤 (Ctrl + 휠 / Ctrl + +/- 지원) */}
          <div className="flex items-center bg-slate-800/80 rounded border border-slate-700/80 text-[10px] shrink-0">
            <button
              onClick={() => changeFontSize(-1)}
              className="px-1.5 py-0.5 hover:text-slate-100 text-slate-400 hover:bg-slate-800 transition"
              title="글자 크기 축소 (Ctrl + -)"
            >
              -
            </button>
            <span
              onClick={resetFontSize}
              className={`px-1.5 py-0.5 font-mono cursor-pointer transition ${
                fontSize !== 13.5
                  ? "text-amber-500 dark:text-amber-300 font-bold bg-amber-500/20 hover:bg-amber-500/30 rounded"
                  : "text-slate-300 hover:text-indigo-400"
              }`}
              title="클릭 시 기본 크기(13.5px)로 원상 복구 (단축키: Ctrl + 0)"
            >
              {fontSize}px{fontSize !== 13.5 ? " (리셋)" : ""}
            </span>
            <button
              onClick={() => changeFontSize(1)}
              className="px-1.5 py-0.5 hover:text-slate-100 text-slate-400 hover:bg-slate-800 transition"
              title="글자 크기 확대 (Ctrl + + / Ctrl + 휠)"
            >
              +
            </button>
          </div>

          <button
            onClick={() => {
              termRef.current?.clear();
              termRef.current?.focus();
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-slate-200 border border-slate-700/70 transition text-[11px] whitespace-nowrap shrink-0"
            title="터미널 화면 비우기"
          >
            <RotateCcw className="w-3 h-3 shrink-0" />
            Clear
          </button>
        </div>
      </div>

      {/* 2. xterm.js 캔버스 컨테이너 (클립보드 이미지/파일 붙여넣기 및 드래그 앤 드롭 지원) */}
      <div className="relative flex-1 w-full min-h-0 overflow-hidden">
        <div
          ref={containerRef}
          className="w-full h-full p-2 overflow-hidden"
          onClick={() => termRef.current?.focus()}
        />
        {/* 드래그 오버 피드백 오버레이 */}
        {isDraggingOver && (
          <div className="absolute inset-0 z-30 bg-indigo-950/85 backdrop-blur-sm border-2 border-dashed border-indigo-400 flex flex-col items-center justify-center pointer-events-none animate-in fade-in duration-100">
            <ImageIcon className="w-10 h-10 text-indigo-400 mb-2 animate-bounce" />
            <div className="text-sm font-bold text-white">파일 또는 이미지를 놓으세요</div>
            <div className="text-xs text-indigo-200 mt-1">채팅창에 첨부됩니다</div>
          </div>
        )}
      </div>

      {/* 3. 하단 전용 채팅 / 프롬프트 입력창 (한글 입력 · 멀티라인 · 슬래시 명령어 · 동시 전송 지원) */}
      {/* 터미널 ↔ 채팅창 높이 조절 핸들 */}
      <div
        onMouseDown={startChatResize}
        className="h-1.5 shrink-0 cursor-row-resize bg-slate-800 hover:bg-indigo-500/70 transition"
        title="드래그하여 채팅창 높이 조절"
      />
      <div
        className="shrink-0 flex flex-col gap-2 bg-slate-900/95 p-2.5"
        style={{ height: chatHeight }}
      >
        {/* 첨부 버튼 · 빠른 슬래시 명령어 바 */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar shrink-0">
          <div className="flex items-center gap-1 shrink-0">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileInputChange}
              className="hidden"
              multiple
            />
            <button
              type="button"
              onClick={() => setIsFilePickerOpen(true)}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600/80 hover:bg-indigo-500 text-white text-[10px] font-semibold transition whitespace-nowrap mr-1"
              title="파일/이미지 첨부 (Ctrl+V 붙여넣기 · 드래그 앤 드롭 지원)"
            >
              <Paperclip className="w-3 h-3" />
              첨부
            </button>
            {QUICK_COMMANDS.map((q) => (
              <button
                key={q.cmd}
                type="button"
                onClick={() => sendRawCommand(q.cmd)}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 border border-slate-700/80 text-[10px] font-mono transition whitespace-nowrap"
                title={q.desc}
              >
                {q.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => apiWriteToSession(session.id, "\x1b")}
              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-amber-300 border border-slate-700/80 text-[10px] font-mono transition whitespace-nowrap"
              title="ESC 키 전송"
            >
              ESC
            </button>
            {cliDef?.loginCommand && (
              <button
                type="button"
                onClick={() => sendRawCommand(cliDef.loginCommand)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700/80 text-[10px] transition whitespace-nowrap"
                title={`터미널에 '${cliDef.loginCommand}' 전송`}
              >
                <LogIn className="w-3 h-3 text-indigo-400" />
                로그인
              </button>
            )}
          </div>

          <div className="flex items-center gap-3 shrink-0 text-[11px]">
            {projectAgentCount > 1 && onBroadcastToProject && (
              <label className="flex items-center gap-1.5 text-fuchsia-300 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={broadcastToProject}
                  onChange={(e) => setBroadcastToProject(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-fuchsia-500"
                />
                <span>[{folderName}] 프로젝트 에이전트 전체({projectAgentCount})에게 동시 하달</span>
              </label>
            )}
            {splitActive && onBroadcastPrompt && (
              <label className="flex items-center gap-1.5 text-indigo-300 cursor-pointer select-none whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={broadcastToSplit}
                  onChange={(e) => setBroadcastToSplit(e.target.checked)}
                  className="rounded border-slate-700 bg-slate-950 text-indigo-500"
                />
                <span>분할된 터미널 전체에 동시 전송</span>
              </label>
            )}
            <span className="text-slate-500 hidden sm:inline whitespace-nowrap">
              Enter: 전송 · Shift+Enter: 줄바꿈 · ↑/↓: 이전 질문
            </span>
          </div>
        </div>

        {/* 첨부된 파일 칩 (전송 시 경로가 메시지 앞에 붙음) */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 shrink-0 max-h-14 overflow-y-auto">
            {attachments.map((p) => (
              <span
                key={p}
                title={p}
                className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-md bg-indigo-500/15 text-indigo-200 border border-indigo-500/30 text-[11px] max-w-[220px]"
              >
                {/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(p) ? (
                  <ImageIcon className="w-3 h-3 shrink-0" />
                ) : (
                  <Paperclip className="w-3 h-3 shrink-0" />
                )}
                <span className="truncate">{p.split(/[/\\]/).pop()}</span>
                <button
                  type="button"
                  onClick={() => setAttachments((prev) => prev.filter((x) => x !== p))}
                  className="p-0.5 rounded hover:bg-indigo-500/30"
                  title="첨부 제거"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        {/* 채팅 입력 박스와 전송 버튼 */}
        <div className="flex items-stretch gap-2 flex-1 min-h-0">
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={(e) => {
              const files = Array.from(e.clipboardData?.files ?? []);
              if (files.length > 0) {
                e.preventDefault();
                attachFiles(files);
              }
            }}
            placeholder={`[${folderName}] ${session.name}에게 보낼 메시지 (파일/이미지는 Ctrl+V로 첨부)...`}
            className="flex-1 h-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-700/90 focus:border-indigo-500 focus:outline-none text-xs text-slate-100 placeholder-slate-500 resize-none leading-relaxed"
          />

          <div className="flex flex-col gap-1 shrink-0">
            <button
              type="button"
              onClick={handleSendChatPrompt}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow transition whitespace-nowrap"
              title="메시지 전송 (Enter)"
            >
              <Send className="w-3.5 h-3.5" />
              전송
            </button>
            <button
              type="button"
              onClick={() => apiWriteToSession(session.id, "\r")}
              className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[10px] font-medium transition whitespace-nowrap"
              title="터미널에 Enter(줄바꿈/확인) 키만 전송"
            >
              <CornerDownLeft className="w-3 h-3" />
              Enter만
            </button>
          </div>
        </div>
      </div>

      {/* 테마 맞춤형 파일 & 이미지 선택 모달 */}
      <FilePickerModal
        isOpen={isFilePickerOpen}
        onClose={() => setIsFilePickerOpen(false)}
        onSelectFiles={addAttachments}
        initialPath={session.cwd}
        onFallbackNative={() => fileInputRef.current?.click()}
      />
    </div>
  );
};
