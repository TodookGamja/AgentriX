import React, { useState } from "react";
import { Image as ImageIcon, Settings, Upload, X } from "lucide-react";
import { Select } from "./Select";
import { FilePickerModal } from "./FilePickerModal";
import { AvatarDisplay } from "./TeamModeView";
import { apiReadFileAsBase64 } from "../lib/tauriBridge";
import type { CliDefinition, UserProfile } from "../types/types";

// 프로필 설정용 테마별 대규모 이모지 프리셋 카테고리
const EMOJI_CATEGORIES = [
  {
    id: "dev",
    name: "개발자 & 엔지니어",
    emojis: [
      "👨‍💻", "👩‍💻", "🧑‍💻", "👨‍🔬", "👩‍🔬", "🧑‍🚀", "👨‍🎨", "🕵️‍♂️",
      "🧙‍♂️", "🦸‍♂️", "🥷", "⚡", "🚀", "👑", "🔥", "💡",
      "🏆", "🎖️", "⭐", "💎",
    ],
  },
  {
    id: "tech",
    name: "AI & 로봇 & 사이버",
    emojis: [
      "🤖", "🦾", "👾", "💻", "🖥️", "⚙️", "🔮", "🧬",
      "📡", "🛸", "🔋", "🛡️", "🎯", "🕹️", "💾", "🌐",
      "📟", "🧭", "🔬", "🔭",
    ],
  },
  {
    id: "animals",
    name: "마스코트 & 동물",
    emojis: [
      "🦊", "🐱", "🐶", "🦁", "🐯", "🐼", "🐨", "🐸",
      "🐙", "🦄", "🦅", "🦉", "🐲", "🦖", "🦈", "🐝",
      "🦔", "🐧", "🐒", "🐺",
    ],
  },
  {
    id: "fun",
    name: "표정 & 캐릭터 & 펀",
    emojis: [
      "😎", "🤠", "🥳", "👻", "👽", "🎃", "🥑", "☕",
      "🍕", "🎮", "🏎️", "🛹", "✨", "🎉", "🌈", "🍟",
      "🍦", "🎸", "🥊", "🎳",
    ],
  },
];

// 사이드바·팀 대시보드 공용 프로필 설정 모달 (열릴 때 마운트되어 현재 프로필로 초기화)
export const ProfileModal: React.FC<{
  userProfile: UserProfile;
  clis: CliDefinition[];
  onSave: (p: UserProfile) => void;
  onClose: () => void;
}> = ({ userProfile, clis, onSave, onClose }) => {
  const [profName, setProfName] = useState(userProfile.name);
  const [profRole, setProfRole] = useState(userProfile.role);
  const [profDept, setProfDept] = useState(userProfile.department);
  const [profCli, setProfCli] = useState(userProfile.favoriteCli);
  const [profEmoji, setProfEmoji] = useState(userProfile.avatarEmoji);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState("dev");
  const [pickerOpen, setPickerOpen] = useState(false);

  // 설치 감지된 CLI를 위로, 미설치는 표시만
  const cliOptions = [...clis]
    .sort((a, b) => Number(b.installed) - Number(a.installed))
    .map((c) => ({
      value: c.id,
      label: `${c.name} (${c.provider})${c.installed ? "" : " · 미설치"}`,
    }));

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim()) return;
    onSave({
      name: profName.trim(),
      role: profRole.trim(),
      department: profDept.trim(),
      favoriteCli: profCli,
      avatarEmoji: profEmoji,
    });
    onClose();
  };

  const handlePickImage = async (paths: string[]) => {
    setPickerOpen(false);
    const dataUrl = paths[0] ? await apiReadFileAsBase64(paths[0]) : null;
    if (dataUrl?.startsWith("data:image/")) setProfEmoji(dataUrl);
  };

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
        <form
          onSubmit={handleProfileSubmit}
          className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between shrink-0">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4 text-indigo-400" />
              <h3 className="text-sm font-bold text-slate-100">내 프로필 설정</h3>
            </div>
            <button
              type="button"
              onClick={() => onClose()}
              className="p-1 rounded text-slate-400 hover:text-slate-100 transition"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-5 space-y-4 text-xs overflow-y-auto flex-1">
            {/* 아바타 선택 및 이미지 업로드 영역 */}
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-bold flex items-center gap-1.5">
                  <ImageIcon className="w-3.5 h-3.5 text-indigo-400" />
                  프로필 아바타 (이모지 또는 이미지 파일)
                </label>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/40 text-[11px] font-semibold transition shadow-sm active:scale-95"
                    title="내 컴퓨터의 이미지 파일(PNG, JPG, SVG, WebP) 업로드"
                  >
                    <Upload className="w-3 h-3" />
                    이미지 파일 등록
                  </button>
                  {(profEmoji.startsWith("data:image/") ||
                    profEmoji.startsWith("http")) && (
                    <button
                      type="button"
                      onClick={() => setProfEmoji("👨‍💻")}
                      className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/40 hover:text-rose-300 text-slate-400 text-[10px] transition"
                      title="이모지로 되돌리기"
                    >
                      이미지 삭제
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="p-2 rounded-2xl bg-slate-900 border border-indigo-500/40 shadow-inner flex items-center justify-center shrink-0">
                  <AvatarDisplay value={profEmoji} size="xl" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="text-[11px] text-slate-400 block mb-1">
                    직접 이모지 입력 또는 아래 프리셋/이미지 선택
                  </span>
                  <input
                    value={profEmoji.startsWith("data:image/") ? "[사용자 업로드 이미지 적용됨]" : profEmoji}
                    onChange={(e) => setProfEmoji(e.target.value)}
                    disabled={profEmoji.startsWith("data:image/")}
                    className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-100 text-xs focus:outline-none focus:border-indigo-500 disabled:text-indigo-400 disabled:font-medium font-mono"
                  />
                </div>
              </div>

              {/* 이모지 카테고리 탭 */}
              <div className="space-y-2 pt-1 border-t border-slate-800/80">
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar pb-1">
                  {EMOJI_CATEGORIES.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveEmojiCategory(cat.id)}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition whitespace-nowrap ${
                        activeEmojiCategory === cat.id
                          ? "bg-indigo-600 text-white shadow-sm"
                          : "bg-slate-900 text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>

                {/* 선택된 카테고리의 이모지 그리드 */}
                <div className="grid grid-cols-8 sm:grid-cols-10 gap-1.5 p-2 rounded-xl bg-slate-900/80 border border-slate-800 max-h-36 overflow-y-auto">
                  {EMOJI_CATEGORIES.find((c) => c.id === activeEmojiCategory)?.emojis.map(
                    (emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => setProfEmoji(emoji)}
                        className={`text-lg p-1.5 rounded-lg border transition hover:scale-110 active:scale-95 flex items-center justify-center ${
                          profEmoji === emoji
                            ? "bg-indigo-600/40 border-indigo-500 shadow-sm"
                            : "bg-slate-950 border-slate-800 hover:border-slate-600"
                        }`}
                      >
                        {emoji}
                      </button>
                    )
                  )}
                </div>
              </div>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold">이름 (닉네임)</label>
              <input
                required
                value={profName}
                onChange={(e) => setProfName(e.target.value)}
                placeholder="예: 홍길동, Alex"
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-300 mb-1 font-semibold">담당 역할 / 직무</label>
                <input
                  value={profRole}
                  onChange={(e) => setProfRole(e.target.value)}
                  placeholder="예: Lead Architect & Developer"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-semibold">부서 / 팀명</label>
                <input
                  value={profDept}
                  onChange={(e) => setProfDept(e.target.value)}
                  placeholder="예: Platform Engineering"
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-slate-300 mb-1 font-semibold">주력 사용 CLI</label>
              <Select
                value={profCli}
                onChange={setProfCli}
                options={cliOptions}
                className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100"
              />
            </div>
          </div>

          <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2 shrink-0">
            <button
              type="button"
              onClick={() => onClose()}
              className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition"
            >
              취소
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
            >
              프로필 저장
            </button>
          </div>
        </form>
      </div>
      <FilePickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelectFiles={handlePickImage}
        filterModeDefault="images"
      />
    </>
  );
};
