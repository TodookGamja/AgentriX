import React, { useState, useEffect } from "react";
import {
  Folder,
  FolderOpen,
  ArrowUp,
  RefreshCw,
  HardDrive,
  Home,
  Monitor,
  FileText,
  Download,
  Clock,
  X,
  Check,
  ChevronRight,
  ExternalLink,
  Search,
} from "lucide-react";
import type { DirectoryListing, DirectoryItem } from "../types/types";
import { apiListDirectoryEntries, apiPickProjectFolder } from "../lib/tauriBridge";

interface FolderPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFolder: (folderPath: string) => void;
  initialPath?: string;
  themeMode?: "light" | "dark" | "auto";
}

export const FolderPickerModal: React.FC<FolderPickerModalProps> = ({
  isOpen,
  onClose,
  onSelectFolder,
  initialPath,
  themeMode = "light",
}) => {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(initialPath || "");
  const [pathInput, setPathInput] = useState<string>("");
  const [selectedFolder, setSelectedFolder] = useState<string>("");
  const [filterText, setFilterText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDirectory = async (targetPath?: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiListDirectoryEntries(targetPath);
      if (data) {
        setListing(data);
        setCurrentPath(data.current_path);
        setPathInput(data.current_path);
        setSelectedFolder(data.current_path);
        setFilterText("");
      } else {
        setErrorMsg("폴더 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setErrorMsg(`폴더 접근 오류: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath);
    }
  }, [isOpen, initialPath]);

  if (!isOpen) return null;

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleGoUp = () => {
    if (listing?.parent_path) {
      loadDirectory(listing.parent_path);
    }
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pathInput.trim()) {
      loadDirectory(pathInput.trim());
    }
  };

  const handleFolderClick = (item: DirectoryItem) => {
    setSelectedFolder(item.path);
  };

  const handleFolderDoubleClick = (item: DirectoryItem) => {
    loadDirectory(item.path);
  };

  const handleConfirmSelect = () => {
    if (selectedFolder) {
      onSelectFolder(selectedFolder);
      onClose();
    }
  };

  const handleFallbackNativePicker = async () => {
    try {
      const picked = await apiPickProjectFolder(themeMode);
      if (picked) {
        onSelectFolder(picked);
        onClose();
      }
    } catch (err) {
      console.error(err);
    }
  };

  const filteredItems = (listing?.items || []).filter((item) => {
    if (!filterText.trim()) return true;
    return item.name.toLowerCase().includes(filterText.toLowerCase());
  });

  const getQuickIcon = (kind: string, isActive: boolean = false) => {
    if (isActive) {
      switch (kind) {
        case "desktop":
          return <Monitor className="w-3.5 h-3.5 text-white" />;
        case "documents":
          return <FileText className="w-3.5 h-3.5 text-white" />;
        case "downloads":
          return <Download className="w-3.5 h-3.5 text-white" />;
        case "home":
          return <Home className="w-3.5 h-3.5 text-white" />;
        case "drive":
          return <HardDrive className="w-3.5 h-3.5 text-white" />;
        case "project":
          return <Clock className="w-3.5 h-3.5 text-white" />;
        default:
          return <Folder className="w-3.5 h-3.5 text-white" />;
      }
    }
    switch (kind) {
      case "desktop":
        return <Monitor className="w-3.5 h-3.5 text-blue-500" />;
      case "documents":
        return <FileText className="w-3.5 h-3.5 text-amber-500" />;
      case "downloads":
        return <Download className="w-3.5 h-3.5 text-emerald-500" />;
      case "home":
        return <Home className="w-3.5 h-3.5 text-purple-500" />;
      case "drive":
        return <HardDrive className="w-3.5 h-3.5 text-cyan-500" />;
      case "project":
        return <Clock className="w-3.5 h-3.5 text-indigo-500" />;
      default:
        return <Folder className="w-3.5 h-3.5 text-slate-400" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[620px]">
        {/* 헤더 */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-indigo-600 dark:bg-indigo-500 flex items-center justify-center text-white shadow-sm">
              <FolderOpen className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                작업 프로젝트 폴더 선택
                <span className="px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-700 text-[10px] font-semibold">
                  AgentriX Explorer
                </span>
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                AI 에이전트와 연동할 프로젝트 디렉토리를 탐색하고 선택하세요.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 경로 네비게이션 바 */}
        <div className="px-5 py-2.5 bg-slate-100/70 dark:bg-slate-950/70 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={handleGoUp}
            disabled={!listing?.parent_path}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 transition"
            title="상위 폴더로 이동"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => loadDirectory(currentPath)}
            className="p-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            title="새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-500" : ""}`} />
          </button>

          {/* 주소 표시줄 */}
          <form onSubmit={handlePathSubmit} className="flex-1 flex items-center">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="C:\경로 직접 입력 후 Enter..."
              className="w-full px-3 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs font-mono text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 shadow-inner"
            />
          </form>

          {/* 필터 검색 */}
          <div className="relative w-40 shrink-0">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="폴더 필터..."
              className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* 본문 2컬럼 레이아웃: 좌측 빠른 바로가기 / 우측 폴더 목록 */}
        <div className="flex-1 flex overflow-hidden">
          {/* 좌측 사이드바: 빠른 바로가기 */}
          <div className="w-52 border-r border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/40 p-3 overflow-y-auto shrink-0 space-y-3">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1">
                빠른 바로가기
              </div>
              <div className="space-y-0.5">
                {(listing?.quick_access || [])
                  .filter((q) => q.kind !== "drive" && q.kind !== "project")
                  .map((item) => {
                    const isActive = currentPath === item.path;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNavigate(item.path)}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-xs text-left flex items-center gap-2 transition ${
                          isActive
                            ? "bg-indigo-600 text-white font-bold shadow-sm"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/60 font-medium"
                        }`}
                      >
                        {getQuickIcon(item.kind, isActive)}
                        <span className="truncate">{item.name}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* 드라이브 목록 */}
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1">
                내 PC 드라이브
              </div>
              <div className="space-y-0.5">
                {(listing?.quick_access || [])
                  .filter((q) => q.kind === "drive")
                  .map((item) => {
                    const isActive = currentPath.startsWith(item.path);
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onClick={() => handleNavigate(item.path)}
                        className={`w-full px-2.5 py-1.5 rounded-lg text-xs text-left flex items-center gap-2 transition ${
                          isActive
                            ? "bg-indigo-600 text-white font-bold shadow-sm"
                            : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/60 font-medium"
                        }`}
                      >
                        {getQuickIcon("drive", isActive)}
                        <span className="truncate">{item.name}</span>
                      </button>
                    );
                  })}
              </div>
            </div>

            {/* 최근 프로젝트 폴더들 */}
            {(listing?.quick_access || []).some((q) => q.kind === "project") && (
              <div>
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1">
                  최근 프로젝트
                </div>
                <div className="space-y-0.5">
                  {(listing?.quick_access || [])
                    .filter((q) => q.kind === "project")
                    .map((item) => {
                      const isActive = currentPath === item.path;
                      return (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => handleNavigate(item.path)}
                          className={`w-full px-2.5 py-1.5 rounded-lg text-xs text-left flex items-center gap-2 transition ${
                            isActive
                              ? "bg-indigo-600 text-white font-bold shadow-sm"
                              : "text-slate-700 dark:text-slate-300 hover:bg-slate-200/70 dark:hover:bg-slate-800/60 font-medium"
                          }`}
                          title={item.path}
                        >
                          {getQuickIcon("project", isActive)}
                          <span className="truncate">{item.name}</span>
                        </button>
                      );
                    })}
                </div>
              </div>
            )}
          </div>

          {/* 우측 폴더 목록 영역 */}
          <div className="flex-1 p-4 overflow-y-auto">
            {errorMsg && (
              <div className="p-3 mb-3 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-700 dark:text-rose-300 text-xs">
                {errorMsg}
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                <Folder className="w-10 h-10 opacity-30" />
                <span className="text-xs">하위 폴더가 없거나 필터 조건과 일치하는 폴더가 없습니다.</span>
                <span className="text-[11px] text-slate-500">현재 경로를 그대로 선택할 수 있습니다.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2">
                {filteredItems.map((item) => {
                  const isSelected = selectedFolder === item.path;
                  return (
                    <div
                      key={item.path}
                      onClick={() => handleFolderClick(item)}
                      onDoubleClick={() => handleFolderDoubleClick(item)}
                      className={`p-2.5 rounded-xl border text-left cursor-pointer transition flex items-center gap-2.5 group ${
                        isSelected
                          ? "bg-indigo-50 dark:bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/30 shadow-sm"
                          : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/40"
                      }`}
                    >
                      <Folder
                        className={`w-5 h-5 shrink-0 transition ${
                          isSelected
                            ? "text-indigo-600 dark:text-indigo-400"
                            : item.is_hidden
                            ? "text-slate-300 dark:text-slate-600"
                            : "text-amber-500 dark:text-amber-400 group-hover:scale-105"
                        }`}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs font-semibold truncate ${
                            isSelected
                              ? "text-indigo-900 dark:text-indigo-200"
                              : item.is_hidden
                              ? "text-slate-400"
                              : "text-slate-800 dark:text-slate-200"
                          }`}
                        >
                          {item.name}
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 shrink-0 opacity-0 group-hover:opacity-100 transition" />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* 푸터 영역 */}
        <div className="px-5 py-3.5 bg-slate-50 dark:bg-slate-950 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleFallbackNativePicker}
              className="text-[11px] text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 flex items-center gap-1 transition"
              title="Windows 시스템 기본 탐색기로 열기"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Windows 기본 대화상자 사용
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="hidden sm:flex items-center gap-1 text-xs text-slate-500 font-mono truncate max-w-[260px]">
              <span className="font-sans text-[11px] text-slate-400">선택됨:</span>
              <span className="truncate">{selectedFolder || currentPath}</span>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition"
            >
              취소
            </button>

            <button
              type="button"
              onClick={handleConfirmSelect}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5 transition"
            >
              <Check className="w-4 h-4" />
              <span>이 폴더 선택</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
