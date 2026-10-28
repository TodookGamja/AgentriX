import React, { useState, useEffect } from "react";
import {
  Folder,
  ArrowUp,
  RefreshCw,
  HardDrive,
  Home,
  Monitor,
  FileText,
  Download,
  Image as ImageIcon,
  Code,
  File,
  X,
  Check,
  Search,
  ExternalLink,
  SlidersHorizontal,
  CheckSquare,
  Square,
} from "lucide-react";
import type { DirectoryListing, DirectoryItem } from "../types/types";
import { apiListDirectoryEntries, apiReadFileAsBase64 } from "../lib/tauriBridge";

interface FilePickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectFiles: (filePaths: string[]) => void;
  initialPath?: string;
  themeMode?: "light" | "dark" | "auto";
  onFallbackNative?: () => void;
  filterModeDefault?: "all" | "images" | "code" | "docs";
}

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"]);
const CODE_EXTS = new Set(["ts", "tsx", "js", "jsx", "rs", "py", "json", "html", "css", "yaml", "yml", "toml", "sh", "bat", "ps1", "sql"]);
const DOC_EXTS = new Set(["md", "txt", "pdf", "doc", "docx", "csv", "log", "rtf"]);

function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const FilePickerModal: React.FC<FilePickerModalProps> = ({
  isOpen,
  onClose,
  onSelectFiles,
  initialPath,
  themeMode: _themeMode = "dark",
  onFallbackNative,
  filterModeDefault = "all",
}) => {
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [currentPath, setCurrentPath] = useState<string>(initialPath || "");
  const [pathInput, setPathInput] = useState<string>("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | "images" | "code" | "docs">(filterModeDefault);
  const [loading, setLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const loadDirectory = async (targetPath?: string) => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiListDirectoryEntries(targetPath, true);
      if (data) {
        setListing(data);
        setCurrentPath(data.current_path);
        setPathInput(data.current_path);
        setFilterText("");
      } else {
        setErrorMsg("디렉토리 목록을 불러오지 못했습니다.");
      }
    } catch (err: any) {
      setErrorMsg(`폴더 접근 오류: ${err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setSelectedPaths(new Set());
      setPreviewPath(null);
      setPreviewDataUrl(null);
      loadDirectory(initialPath);
    }
  }, [isOpen, initialPath]);

  // 미리보기 이미지 로드
  useEffect(() => {
    let isCancelled = false;
    if (!previewPath) {
      setPreviewDataUrl(null);
      return;
    }
    const ext = previewPath.split(".").pop()?.toLowerCase();
    if (ext && IMAGE_EXTS.has(ext)) {
      apiReadFileAsBase64(previewPath).then((dataUrl) => {
        if (!isCancelled) {
          setPreviewDataUrl(dataUrl);
        }
      });
    } else {
      setPreviewDataUrl(null);
    }
    return () => {
      isCancelled = true;
    };
  }, [previewPath]);

  // ESC 키로 닫기
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

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

  const toggleSelect = (item: DirectoryItem) => {
    if (item.is_dir) {
      // 폴더는 더블클릭으로 진입하도록 안내하거나 단일 클릭 시 상태만 기억
      return;
    }
    setPreviewPath(item.path);
    setSelectedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(item.path)) {
        next.delete(item.path);
      } else {
        next.add(item.path);
      }
      return next;
    });
  };

  const handleItemDoubleClick = (item: DirectoryItem) => {
    if (item.is_dir) {
      loadDirectory(item.path);
    } else {
      // 파일 더블클릭 시 즉시 이 파일 단독 선택 및 완료
      onSelectFiles([item.path]);
      onClose();
    }
  };

  const handleConfirmSelect = () => {
    if (selectedPaths.size > 0) {
      onSelectFiles(Array.from(selectedPaths));
      onClose();
    } else if (previewPath) {
      onSelectFiles([previewPath]);
      onClose();
    }
  };

  const filteredItems = (listing?.items || []).filter((item) => {
    if (item.is_dir) return true; // 폴더는 항상 탐색을 위해 표시

    // 텍스트 검색 필터
    if (filterText.trim()) {
      if (!item.name.toLowerCase().includes(filterText.toLowerCase())) {
        return false;
      }
    }

    // 카테고리 필터
    const ext = item.extension?.toLowerCase() || "";
    if (categoryFilter === "images") {
      return IMAGE_EXTS.has(ext);
    }
    if (categoryFilter === "code") {
      return CODE_EXTS.has(ext);
    }
    if (categoryFilter === "docs") {
      return DOC_EXTS.has(ext);
    }
    return true;
  });

  const getQuickIcon = (kind: string, isActive: boolean = false) => {
    const cls = isActive ? "w-3.5 h-3.5 text-white" : "w-3.5 h-3.5";
    switch (kind) {
      case "desktop":
        return <Monitor className={`${cls} ${!isActive ? "text-blue-400" : ""}`} />;
      case "pictures":
        return <ImageIcon className={`${cls} ${!isActive ? "text-purple-400" : ""}`} />;
      case "documents":
        return <FileText className={`${cls} ${!isActive ? "text-amber-400" : ""}`} />;
      case "downloads":
        return <Download className={`${cls} ${!isActive ? "text-emerald-400" : ""}`} />;
      case "home":
        return <Home className={`${cls} ${!isActive ? "text-pink-400" : ""}`} />;
      case "drive":
        return <HardDrive className={`${cls} ${!isActive ? "text-cyan-400" : ""}`} />;
      default:
        return <Folder className={`${cls} ${!isActive ? "text-slate-400" : ""}`} />;
    }
  };

  const getItemIcon = (item: DirectoryItem) => {
    if (item.is_dir) {
      return <Folder className="w-4 h-4 text-amber-400 shrink-0" />;
    }
    const ext = item.extension?.toLowerCase() || "";
    if (IMAGE_EXTS.has(ext)) {
      return <ImageIcon className="w-4 h-4 text-purple-400 shrink-0" />;
    }
    if (CODE_EXTS.has(ext)) {
      return <Code className="w-4 h-4 text-cyan-400 shrink-0" />;
    }
    if (DOC_EXTS.has(ext)) {
      return <FileText className="w-4 h-4 text-blue-400 shrink-0" />;
    }
    return <File className="w-4 h-4 text-slate-400 shrink-0" />;
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 select-none animate-in fade-in duration-150">
      <div className="w-full max-w-4xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col h-[650px] text-slate-100">
        {/* 헤더 */}
        <div className="px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-md">
              <ImageIcon className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                파일 및 이미지 첨부
                <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-[10px] font-semibold">
                  AgentriX UI Theme
                </span>
              </h2>
              <p className="text-[11px] text-slate-400">
                터미널 및 AI 에이전트에 전달할 이미지나 파일을 선택하세요 (복수 선택 및 더블클릭 즉시 선택 지원)
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 경로 네비게이션 & 필터 툴바 */}
        <div className="px-4 py-2.5 bg-slate-950/70 border-b border-slate-800 flex items-center gap-2 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={handleGoUp}
            disabled={!listing?.parent_path}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 disabled:opacity-40 transition"
            title="상위 폴더로 이동"
          >
            <ArrowUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => loadDirectory(currentPath)}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-200 hover:bg-slate-800 transition"
            title="새로고침"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-400" : ""}`} />
          </button>

          {/* 주소 표시줄 */}
          <form onSubmit={handlePathSubmit} className="flex-1 min-w-[200px] flex items-center">
            <input
              type="text"
              value={pathInput}
              onChange={(e) => setPathInput(e.target.value)}
              placeholder="C:\경로 직접 입력 후 Enter..."
              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs font-mono text-slate-100 focus:outline-none focus:border-indigo-500 shadow-inner"
            />
          </form>

          {/* 카테고리 필터 탭 */}
          <div className="flex items-center gap-1 bg-slate-900 p-0.5 rounded-lg border border-slate-800 text-[11px]">
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={`px-2 py-1 rounded-md transition font-medium ${
                categoryFilter === "all" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter("images")}
              className={`px-2 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                categoryFilter === "images" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <ImageIcon className="w-3 h-3 text-purple-400" />
              이미지
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter("code")}
              className={`px-2 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                categoryFilter === "code" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Code className="w-3 h-3 text-cyan-400" />
              코드
            </button>
            <button
              type="button"
              onClick={() => setCategoryFilter("docs")}
              className={`px-2 py-1 rounded-md transition font-medium flex items-center gap-1 ${
                categoryFilter === "docs" ? "bg-indigo-600 text-white font-bold" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <FileText className="w-3 h-3 text-amber-400" />
              문서
            </button>
          </div>

          {/* 파일명 실시간 필터 */}
          <div className="relative w-36 shrink-0">
            <input
              type="text"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              placeholder="파일 검색..."
              className="w-full pl-7 pr-2 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-indigo-500"
            />
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
          </div>
        </div>

        {/* 본문 3단 레이아웃: [빠른 바로가기] | [파일 및 폴더 목록] | [미리보기 패널] */}
        <div className="flex-1 flex overflow-hidden">
          {/* 1단: 빠른 바로가기 사이드바 */}
          <div className="w-48 border-r border-slate-800 bg-slate-950/40 p-3 overflow-y-auto shrink-0 space-y-3">
            <div>
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
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
                            : "text-slate-300 hover:bg-slate-800/60 font-medium"
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
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 mb-1.5">
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
                            : "text-slate-300 hover:bg-slate-800/60 font-medium"
                        }`}
                      >
                        {getQuickIcon("drive", isActive)}
                        <span className="truncate">{item.name}</span>
                      </button>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* 2단: 폴더 및 파일 리스트 */}
          <div className="flex-1 p-3 overflow-y-auto space-y-1">
            {errorMsg && (
              <div className="p-3 mb-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs">
                {errorMsg}
              </div>
            )}

            {filteredItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                <FileText className="w-10 h-10 opacity-30" />
                <span className="text-xs">폴더가 비어있거나 필터 조건과 일치하는 항목이 없습니다.</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {filteredItems.map((item) => {
                  const isSelected = selectedPaths.has(item.path);
                  const isPreviewing = previewPath === item.path;
                  return (
                    <div
                      key={item.path}
                      onClick={() => {
                        if (item.is_dir) {
                          handleNavigate(item.path);
                        } else {
                          toggleSelect(item);
                        }
                      }}
                      onDoubleClick={() => handleItemDoubleClick(item)}
                      className={`p-2 rounded-xl border text-left cursor-pointer transition flex items-center gap-2 select-none group ${
                        isSelected
                          ? "bg-indigo-600/20 border-indigo-500 ring-1 ring-indigo-500/50 shadow-sm"
                          : isPreviewing
                          ? "bg-slate-800/80 border-slate-600"
                          : "bg-slate-900/80 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50"
                      }`}
                    >
                      {/* 폴더가 아닐 때 체크박스 */}
                      {!item.is_dir ? (
                        <div
                          className="shrink-0 text-slate-400 group-hover:text-slate-200"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleSelect(item);
                          }}
                        >
                          {isSelected ? (
                            <CheckSquare className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Square className="w-4 h-4 opacity-50 group-hover:opacity-100" />
                          )}
                        </div>
                      ) : null}

                      {getItemIcon(item)}

                      <div className="min-w-0 flex-1">
                        <div
                          className={`text-xs truncate ${
                            isSelected
                              ? "text-indigo-300 font-bold"
                              : item.is_hidden
                              ? "text-slate-500"
                              : "text-slate-200 font-medium"
                          }`}
                          title={item.name}
                        >
                          {item.name}
                        </div>
                        {!item.is_dir && item.size !== undefined && (
                          <div className="text-[10px] text-slate-500 font-mono">
                            {formatBytes(item.size)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 3단: 파일 및 이미지 미리보기 사이드바 */}
          <div className="w-64 border-l border-slate-800 bg-slate-950/50 p-3.5 flex flex-col justify-between shrink-0">
            <div className="space-y-3">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                선택 미리보기
              </div>

              {previewPath ? (
                <div className="space-y-3">
                  {/* 이미지 썸네일 미리보기 */}
                  {previewDataUrl ? (
                    <div className="rounded-xl border border-slate-800 bg-black/40 overflow-hidden flex items-center justify-center p-2 h-44">
                      <img
                        src={previewDataUrl}
                        alt="Preview"
                        className="max-h-full max-w-full object-contain rounded"
                      />
                    </div>
                  ) : (
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 text-center h-44 flex flex-col items-center justify-center gap-2">
                      <File className="w-8 h-8 text-slate-500" />
                      <span className="text-[11px] text-slate-400">일반 파일 (미리보기 없음)</span>
                    </div>
                  )}

                  <div className="space-y-1 text-xs">
                    <div className="font-semibold text-slate-200 break-all">
                      {previewPath.split(/[/\\]/).pop()}
                    </div>
                    <div className="text-[10px] text-slate-500 font-mono break-all line-clamp-3" title={previewPath}>
                      {previewPath}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-44 border border-dashed border-slate-800 rounded-xl flex flex-col items-center justify-center text-center p-4 text-slate-500 gap-1.5">
                  <ImageIcon className="w-6 h-6 opacity-40" />
                  <span className="text-[11px]">파일이나 이미지를 클릭하면 미리보기가 표시됩니다.</span>
                </div>
              )}
            </div>

            {/* 선택 현황 요약 */}
            <div className="pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>선택된 파일 수:</span>
                <span className="font-bold text-indigo-400">{selectedPaths.size} 개</span>
              </div>
              <div className="text-[10px] text-slate-500">
                더블클릭하면 1개 파일을 즉시 첨부할 수 있습니다.
              </div>
            </div>
          </div>
        </div>

        {/* 푸터 영역 */}
        <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            {onFallbackNative && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onFallbackNative();
                }}
                className="text-[11px] text-slate-400 hover:text-indigo-400 flex items-center gap-1 transition"
                title="Windows 시스템 기본 파일 열기 대화상자로 열기"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                Windows 기본 대화상자 사용
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition"
            >
              취소
            </button>

            <button
              type="button"
              disabled={selectedPaths.size === 0 && !previewPath}
              onClick={handleConfirmSelect}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:hover:bg-indigo-600 text-white text-xs font-bold shadow-md flex items-center gap-1.5 transition active:scale-95"
            >
              <Check className="w-4 h-4" />
              <span>
                {selectedPaths.size > 0
                  ? `${selectedPaths.size}개 파일 첨부`
                  : previewPath
                  ? "선택한 파일 첨부"
                  : "파일 첨부"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
