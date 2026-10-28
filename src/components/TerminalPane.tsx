import React, { useEffect, useRef, useState } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import {
  CornerDownLeft,
  FolderOpen,
  Image as ImageIcon,
  KeyRound,
  LogIn,
  Paperclip,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Square,
  TerminalSquare,
  Zap,
} from "lucide-react";
import type { CliDefinition, SessionInfo } from "../types/types";
import { listen } from "@tauri-apps/api/event";
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
  headroomEnabled: boolean;
  cavemanEnabled: boolean;
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
  headroomEnabled,
  cavemanEnabled,
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
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const cursorRef = useRef<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

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

  // 첨부 파일 선택 창에서 파일/이미지가 선택되었을 때
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async () => {
          const b64 = reader.result as string;
          try {
            const savedPath = await apiSaveClipboardImage(b64, session.cwd, "png");
            const payload = `"${savedPath}" `;
            await apiWriteToSession(session.id, payload);
            if (termRef.current) {
              termRef.current.write(payload);
            }
          } catch (err) {
            console.error("이미지 첨부 저장 오류:", err);
          }
        };
        reader.readAsDataURL(file);
      } else {
        const anyF = file as any;
        const filePath = anyF.path || file.name;
        const payload = `"${filePath}" `;
        await apiWriteToSession(session.id, payload);
        if (termRef.current) {
          termRef.current.write(payload);
        }
      }
    }
    e.target.value = "";
  };

  // AgentriX 테마 커스텀 파일 피커에서 파일들이 선택되었을 때
  const handleCustomFilePickerSelect = async (paths: string[]) => {
    if (!paths || paths.length === 0) return;
    const payload = paths.map((p) => `"${p}"`).join(" ") + " ";
    await apiWriteToSession(session.id, payload);
    if (termRef.current) {
      termRef.current.write(payload);
      termRef.current.focus();
    }
  };

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

    const dataDisposable = term.onData((data) => {
      apiWriteToSession(session.id, data).catch(console.error);
      if (data.includes("\r") && onActivity) {
        onActivity();
      }
    });

    let active = true;
    const pollInterval = window.setInterval(async () => {
      if (!active) return;
      try {
        const chunk = await apiReadSessionOutput(session.id, cursorRef.current);
        if (chunk.data && chunk.data.length > 0) {
          cursorRef.current = chunk.nextCursor;
          term.write(chunk.data);
          term.scrollToBottom();
          if (onOutputChunk) {
            onOutputChunk(session.id, chunk.data);
          }
        }
      } catch {
        // 세션 종료 시 무시
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
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (items) {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith("image/")) {
            e.preventDefault();
            e.stopPropagation();
            const file = item.getAsFile();
            if (file) {
              const reader = new FileReader();
              reader.onload = async () => {
                const b64 = reader.result as string;
                try {
                  const savedPath = await apiSaveClipboardImage(b64, session.cwd, "png");
                  const payload = `"${savedPath}" `;
                  await apiWriteToSession(session.id, payload);
                  if (termRef.current) {
                    termRef.current.write(payload);
                  }
                } catch (err) {
                  console.error("클립보드 이미지 저장 오류:", err);
                }
              };
              reader.readAsDataURL(file);
              return;
            }
          }
        }
      }

      const files = e.clipboardData?.files;
      if (files && files.length > 0) {
        const filePaths: string[] = [];
        for (let i = 0; i < files.length; i++) {
          const f = files[i] as any;
          if (f.path) {
            filePaths.push(`"${f.path}"`);
          }
        }
        if (filePaths.length > 0) {
          e.preventDefault();
          e.stopPropagation();
          const payload = filePaths.join(" ") + " ";
          await apiWriteToSession(session.id, payload);
          if (termRef.current) {
            termRef.current.write(payload);
          }
          return;
        }
      }
    };

    // 파일 드래그 앤 드롭 핸들러
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "copy";
      }
      setIsDraggingOver(true);
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);
    };

    const handleDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      const paths: string[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i] as any;
        if (f.path) {
          paths.push(`"${f.path}"`);
        }
      }

      if (paths.length > 0) {
        const payload = paths.join(" ") + " ";
        await apiWriteToSession(session.id, payload);
        if (termRef.current) {
          termRef.current.write(payload);
        }
      }
    };

    container.addEventListener("paste", handlePaste);
    container.addEventListener("dragover", handleDragOver);
    container.addEventListener("dragleave", handleDragLeave);
    container.addEventListener("drop", handleDrop);

    setTimeout(() => {
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
      container.removeEventListener("dragover", handleDragOver);
      container.removeEventListener("dragleave", handleDragLeave);
      container.removeEventListener("drop", handleDrop);
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

  // 실시간 PTY 데이터 스트리밍 이벤트 수신 (폴링 지연 없는 0ms 즉시 화면 반영)
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ sessionId: string; data: string }>("pty-data", (event) => {
      if (event.payload.sessionId === session.id && termRef.current) {
        termRef.current.write(event.payload.data);
        termRef.current.scrollToBottom();
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [session.id]);

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
    if (!trimmed) {
      await apiWriteToSession(session.id, "\r");
      termRef.current?.scrollToBottom();
      termRef.current?.focus();
      return;
    }

    if (broadcastToProject && onBroadcastToProject) {
      await onBroadcastToProject(session.cwd, `${trimmed}\r`);
    } else if (broadcastToSplit && splitActive && onBroadcastPrompt) {
      await onBroadcastPrompt(`${trimmed}\r`);
    } else {
      await apiWriteToSession(session.id, `${trimmed}\r`);
    }

    setPromptHistory((prev) => [trimmed, ...prev.slice(0, 29)]);
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
  const isWrapper = session.binaryPath.includes("Headroom Wrapper");

  return (
    <div className="flex flex-col w-full h-full bg-[#090d16] border border-slate-800/80 rounded-xl overflow-hidden">
      {/* 1. 상단 세션 헤더 바 (절대 줄바꿈/찌그러짐 없도록 whitespace-nowrap & shrink-0 적용) */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 bg-slate-900/95 border-b border-slate-800/80 text-xs overflow-x-auto no-scrollbar shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <TerminalSquare
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: cliDef?.accentColor ?? "#818cf8" }}
          />
          <span className="font-bold text-slate-100 whitespace-nowrap">
            {session.name}
          </span>

          {session.agentRole && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-fuchsia-500/15 text-fuchsia-300 border border-fuchsia-500/30 text-[11px] font-semibold whitespace-nowrap shrink-0"
              title={session.rolePrompt ?? session.agentRole}
            >
              역할: {session.agentRole}
            </span>
          )}

          {/* 프로젝트 폴더 배지 (짧은 프로젝트명 표시 + 마우스 오버 시 전체 경로) */}
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-mono text-[11px] font-semibold whitespace-nowrap shrink-0"
            title={`작업 프로젝트 폴더: ${session.cwd}`}
          >
            <FolderOpen className="w-3 h-3 shrink-0" />
            {folderName}
          </span>

          {isWrapper && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 text-[10px] font-semibold whitespace-nowrap shrink-0">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              Headroom
            </span>
          )}

          {session.envInjected.length > 0 ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 text-[10px] whitespace-nowrap shrink-0">
              <KeyRound className="w-2.5 h-2.5 shrink-0" />
              API 키 주입됨
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-[10px] whitespace-nowrap shrink-0">
              <ShieldCheck className="w-2.5 h-2.5 shrink-0" />
              구독 인증
            </span>
          )}

          {(headroomEnabled || cavemanEnabled) && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[10px] whitespace-nowrap shrink-0">
              <Sparkles className="w-2.5 h-2.5 shrink-0" />
              {[
                headroomEnabled ? "Headroom" : null,
                cavemanEnabled ? "Caveman" : null,
              ]
                .filter(Boolean)
                .join(" + ")}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {session.rolePrompt && (
            <button
              onClick={handleInjectRoleBriefing}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-fuchsia-600/80 hover:bg-fuchsia-500 text-white font-semibold transition text-[11px] whitespace-nowrap shrink-0 shadow"
              title="이 프로젝트에 설정된 에이전트 전담 역할 지침(Role Briefing)을 터미널에 즉시 주입합니다"
            >
              <Sparkles className="w-3 h-3 shrink-0" />
              역할 지침 주입
            </button>
          )}
          {cliDef?.loginCommand && (
            <button
              onClick={() => sendRawCommand(cliDef.loginCommand)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition text-[11px] whitespace-nowrap shrink-0"
              title={`터미널에 '${cliDef.loginCommand}' 전송`}
            >
              <LogIn className="w-3 h-3 text-indigo-400 shrink-0" />
              로그인
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

          {/* 파일 / 이미지 첨부 (테마 맞춤형 모달 UI 및 클립보드 Ctrl+V 및 드래그 앤 드롭 지원) */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileInputChange}
            className="hidden"
            multiple
          />
          <button
            onClick={() => setIsFilePickerOpen(true)}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition text-[11px] font-semibold whitespace-nowrap shrink-0 shadow-sm"
            title="이미지 또는 파일 선택 (테마 맞춤 파일 탐색기 열기 / Ctrl+V 붙여넣기 및 드래그 앤 드롭 지원)"
          >
            <Paperclip className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
            <span className="hidden sm:inline">파일/이미지 첨부</span>
          </button>

          <button
            onClick={() => apiWriteToSession(session.id, "\x03")}
            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 transition text-[11px] whitespace-nowrap shrink-0"
            title="Ctrl+C (실행 중단 신호 전송)"
          >
            <Square className="w-2.5 h-2.5 fill-current shrink-0" />
            중단(Ctrl+C)
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
            <div className="text-xs text-indigo-200 mt-1">경로가 터미널 프롬프트에 자동으로 입력됩니다</div>
          </div>
        )}
      </div>

      {/* 3. 하단 전용 채팅 / 프롬프트 입력창 (한글 입력 · 멀티라인 · 슬래시 명령어 · 동시 전송 지원) */}
      <div className="shrink-0 bg-slate-900/95 border-t border-slate-800 p-2.5 space-y-2">
        {/* 빠른 슬래시 명령어 & 프로젝트 경로 바 */}
        <div className="flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          <div className="flex items-center gap-1 shrink-0">
            <span className="text-[10px] text-slate-400 mr-1 whitespace-nowrap">
              빠른 명령:
            </span>
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

        {/* 채팅 입력 박스와 전송 버튼 */}
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <textarea
              rows={2}
              value={promptText}
              onChange={(e) => setPromptText(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={async (e) => {
                const items = e.clipboardData?.items;
                if (items) {
                  for (let i = 0; i < items.length; i++) {
                    const item = items[i];
                    if (item.type.startsWith("image/")) {
                      e.preventDefault();
                      const file = item.getAsFile();
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = async () => {
                          const b64 = reader.result as string;
                          try {
                            const savedPath = await apiSaveClipboardImage(b64, session.cwd, "png");
                            setPromptText((prev) => (prev ? `${prev} "${savedPath}" ` : `"${savedPath}" `));
                          } catch (err) {
                            console.error("채팅창 이미지 붙여넣기 실패:", err);
                          }
                        };
                        reader.readAsDataURL(file);
                        return;
                      }
                    }
                  }
                }
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  const paths: string[] = [];
                  for (let i = 0; i < files.length; i++) {
                    const f = files[i] as any;
                    if (f.path) paths.push(`"${f.path}"`);
                  }
                  if (paths.length > 0) {
                    e.preventDefault();
                    setPromptText((prev) => (prev ? `${prev} ${paths.join(" ")} ` : `${paths.join(" ")} `));
                  }
                }
              }}
              placeholder={`[${folderName}] ${session.name}에게 보낼 메시지나 파일/이미지 붙여넣기(Ctrl+V)...`}
              className="w-full pl-3 pr-8 py-2 rounded-lg bg-slate-950 border border-slate-700/90 focus:border-indigo-500 focus:outline-none text-xs text-slate-100 placeholder-slate-500 resize-none leading-relaxed"
            />
            <button
              type="button"
              onClick={() => setIsFilePickerOpen(true)}
              className="absolute right-2.5 top-2.5 p-1 rounded-md text-slate-400 hover:text-indigo-400 hover:bg-slate-800 transition"
              title="파일 또는 이미지 탐색 모달 열기"
            >
              <Paperclip className="w-3.5 h-3.5" />
            </button>
          </div>

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
        onSelectFiles={handleCustomFilePickerSelect}
        initialPath={session.cwd}
        onFallbackNative={() => fileInputRef.current?.click()}
      />
    </div>
  );
};
