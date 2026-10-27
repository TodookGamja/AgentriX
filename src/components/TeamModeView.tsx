import React, { useRef, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Award,
  CheckCircle2,
  Image as ImageIcon,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import type { TeamMemberRecord, UserProfile } from "../types/types";

interface TeamModeViewProps {
  members: TeamMemberRecord[];
  onRefreshTeam: () => Promise<void>;
  onAddMember?: (name: string, role: string, dept: string, cli: string) => Promise<void>;
  onDeleteMember?: (memberId: string) => Promise<void>;
  userProfile?: UserProfile;
  onUpdateUserProfile?: (profile: UserProfile) => void;
  myUsage?: {
    rolling5h: number;
    weekly: number;
    savedPct: number;
    costUsd: number;
  };
}

// 이모지 또는 이미지 아바타를 고해상도로 둥글게 렌더링하는 통합 컴포넌트
export const AvatarDisplay: React.FC<{
  value?: string;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
}> = ({ value = "👨‍💻", className = "", size = "md" }) => {
  const isImage =
    value.startsWith("data:image/") ||
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("blob:");

  const sizeClasses = {
    sm: "w-5 h-5 text-xs",
    md: "w-7 h-7 text-sm",
    lg: "w-10 h-10 text-xl",
    xl: "w-14 h-14 text-2xl",
  }[size];

  if (isImage) {
    return (
      <img
        src={value}
        alt="Avatar"
        className={`${sizeClasses} rounded-full object-cover border border-indigo-500/40 shadow-sm shrink-0 ${className}`}
      />
    );
  }

  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 rounded-full select-none ${sizeClasses} ${className}`}
    >
      {value || "👨‍💻"}
    </span>
  );
};

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

export const TeamModeView: React.FC<TeamModeViewProps> = ({
  members,
  onRefreshTeam,
  onAddMember,
  onDeleteMember,
  userProfile = {
    name: "나 (내 프로필)",
    role: "Lead Architect & Developer",
    department: "Platform Engineering",
    favoriteCli: "claude",
    avatarEmoji: "👨‍💻",
  },
  onUpdateUserProfile,
  myUsage = {
    rolling5h: 0,
    weekly: 0,
    savedPct: 35.0,
    costUsd: 0.0,
  },
}) => {
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("Software Engineer");
  const [newDept, setNewDept] = useState("Platform");
  const [newCli, setNewCli] = useState("claude");
  const [newConnectType, setNewConnectType] = useState<"workspace" | "apikey" | "endpoint">("workspace");
  const [newConnectTarget, setNewConnectTarget] = useState("");
  const [newQuotaLimit, setNewQuotaLimit] = useState("500k");

  // 내 프로필 설정 모달 상태
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [profName, setProfName] = useState(userProfile.name);
  const [profRole, setProfRole] = useState(userProfile.role);
  const [profDept, setProfDept] = useState(userProfile.department);
  const [profCli, setProfCli] = useState(userProfile.favoriteCli);
  const [profEmoji, setProfEmoji] = useState(userProfile.avatarEmoji);
  const [activeEmojiCategory, setActiveEmojiCategory] = useState("dev");

  const fileInputRef = useRef<HTMLInputElement>(null);

  const totalTeamWeekly = members.reduce((acc, m) => acc + m.weeklyTokens, myUsage.weekly);
  const totalTeamCost = members.reduce((acc, m) => acc + m.costUsd, myUsage.costUsd);
  const avgSavedPct =
    members.length > 0
      ? (members.reduce((acc, m) => acc + m.savedTokensPct, myUsage.savedPct)) / (members.length + 1)
      : myUsage.savedPct;

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName.trim() || !onAddMember) return;
    await onAddMember(newName.trim(), newRole.trim(), newDept.trim(), newCli);
    setNewName("");
    setShowAddModal(false);
  };

  const handleProfileSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!profName.trim()) return;
    if (onUpdateUserProfile) {
      onUpdateUserProfile({
        name: profName.trim(),
        role: profRole.trim(),
        department: profDept.trim(),
        favoriteCli: profCli,
        avatarEmoji: profEmoji,
      });
    }
    setShowProfileModal(false);
  };

  const openProfileModal = () => {
    setProfName(userProfile.name);
    setProfRole(userProfile.role);
    setProfDept(userProfile.department);
    setProfCli(userProfile.favoriteCli);
    setProfEmoji(userProfile.avatarEmoji);
    setActiveEmojiCategory("dev");
    setShowProfileModal(true);
  };

  // 이미지 파일 업로드 핸들러 (Base64 변환)
  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      alert("이미지 파일(PNG, JPG, SVG, WebP 등)만 선택할 수 있습니다.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      if (dataUrl) {
        setProfEmoji(dataUrl);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div className="absolute inset-0 overflow-y-auto p-6 space-y-6 pb-24 bg-slate-950">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-400" />
            팀 사용량 대시보드
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            팀원별 CLI 세션 사용량을 실시간으로 집계하고 토큰 절감 현황을 모니터링합니다.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={openProfileModal}
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-indigo-600 dark:text-indigo-300 border border-indigo-500/30 text-xs font-bold transition shadow-sm active:scale-95"
          >
            <Settings className="w-3.5 h-3.5" />
            내 프로필 설정
          </button>

          {onAddMember && (
            <button
              onClick={() => setShowAddModal(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow active:scale-95"
            >
              <UserPlus className="w-3.5 h-3.5" />
              새 팀원 등록
            </button>
          )}

          <button
            onClick={onRefreshTeam}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-bold transition active:scale-95"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            팀 뷰 동기화
          </button>
        </div>
      </div>

      {/* 내 프로필 카드 (호스트 배너) */}
      <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3.5 min-w-0">
          <div className="p-1.5 rounded-2xl bg-slate-950 border border-indigo-500/30 shadow-inner shrink-0">
            <AvatarDisplay value={userProfile.avatarEmoji} size="xl" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-nowrap">
              <span className="font-bold text-sm text-slate-100 truncate">{userProfile.name}</span>
              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 text-[10px] font-bold border border-indigo-500/30 whitespace-nowrap shrink-0">
                호스트 / 나
              </span>
            </div>
            <div className="text-xs text-slate-400 mt-1 truncate">
              {userProfile.role} · <span className="text-slate-500">{userProfile.department}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 text-xs font-mono shrink-0">
          <div className="text-right">
            <div className="text-[10px] text-slate-500 font-medium">주력 도구</div>
            <div className="font-bold text-indigo-600 dark:text-indigo-300 uppercase">{userProfile.favoriteCli}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-slate-500 font-medium">내 주간 토큰</div>
            <div className="font-extrabold text-slate-100">{myUsage.weekly.toLocaleString()}</div>
          </div>
          <button
            onClick={openProfileModal}
            className="px-3 py-1.5 rounded-lg bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-700 dark:text-indigo-200 text-xs font-bold border border-indigo-500/40 transition active:scale-95"
          >
            프로필 수정
          </button>
        </div>
      </div>

      {/* 팀 요약 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-300">팀 주간 총 토큰 사용량</div>
          <div className="text-2xl font-extrabold font-mono text-indigo-600 dark:text-indigo-400 mt-1">
            {(totalTeamWeekly / 1_000_000).toFixed(1)}M
            <span className="text-xs text-slate-400 font-normal ml-1">tokens</span>
          </div>
          <div className="text-[11px] text-slate-400 mt-2 font-medium">
            호스트 포함 {members.length + 1}명 주간 누적
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-300">팀 평균 토큰 절감률 (Headroom·Caveman)</div>
          <div className="text-2xl font-extrabold font-mono text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-1.5">
            <Sparkles className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            {avgSavedPct.toFixed(1)}%
          </div>
          <div className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-2 font-medium">
            컨텍스트 압축 및 중복 방지 절감 효과 가동 중
          </div>
        </div>

        <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 shadow-sm">
          <div className="text-xs font-semibold text-slate-300">팀 주간 환산 총 비용</div>
          <div className="text-2xl font-extrabold font-mono text-amber-600 dark:text-amber-400 mt-1">
            ${totalTeamCost.toFixed(2)}
          </div>
          <div className="text-[11px] text-slate-400 mt-2 font-medium">
            주간 토큰 기준 Claude 3.5 Sonnet 환산 추정치
          </div>
        </div>
      </div>

      {/* 팀원별 토큰 소비량 시각화 바 차트 */}
      {members.length > 0 && (
        <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <Award className="w-4 h-4 text-indigo-400" />
              팀원별 주간 토큰 소비 & 절감 기여도 비교
            </h3>
            <span className="text-xs text-slate-400">단위: 토큰 (Tokens)</span>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={[
                  {
                    name: `${userProfile.name} (나)`,
                    weekly: myUsage.weekly,
                    saved: Math.round(myUsage.weekly * (myUsage.savedPct / 100)),
                  },
                  ...members.map((m) => ({
                    name: m.memberName,
                    weekly: m.weeklyTokens,
                    saved: Math.round(m.weeklyTokens * (m.savedTokensPct / 100)),
                  })),
                ]}
                margin={{ top: 10, right: 20, left: 20, bottom: 20 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
                <XAxis dataKey="name" stroke="#94a3b8" fontSize={11} />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#0f172a",
                    borderColor: "#334155",
                    borderRadius: "0.5rem",
                    fontSize: "12px",
                  }}
                  formatter={(val: number) => [`${val.toLocaleString()} tokens`]}
                />
                <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                <Bar
                  dataKey="weekly"
                  name="주간 총 소비량"
                  fill="#6366f1"
                  radius={[4, 4, 0, 0]}
                />
                <Bar
                  dataKey="saved"
                  name="절감된 토큰"
                  fill="#10b981"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* 팀 멤버 상세 테이블 (호스트는 상시 최상단 고정, 창 크기 축소 시에도 두 줄 꺾임 절대 방지) */}
      <div className="rounded-xl bg-slate-900/90 border border-slate-800 overflow-x-auto shadow-sm">
        <table className="w-full text-left border-collapse text-xs whitespace-nowrap min-w-[760px]">
          <thead>
            <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/70 select-none">
              <th className="py-3 px-4 whitespace-nowrap">팀원</th>
              <th className="py-3 px-4 whitespace-nowrap">역할 / 부서</th>
              <th className="py-3 px-4 whitespace-nowrap">주력 CLI</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">5시간 롤링</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">주간 사용량</th>
              <th className="py-3 px-4 text-center whitespace-nowrap">토큰 관리 도구</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">절감률</th>
              <th className="py-3 px-4 text-right whitespace-nowrap">환산 비용</th>
              <th className="py-3 px-4 text-center whitespace-nowrap">관리</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/70">
            {/* 1. 호스트(나) 행: 언제나 최상단 고정 (whitespace-nowrap + shrink-0로 두줄 깨짐 완벽 방지) */}
            <tr className="bg-indigo-500/10 hover:bg-indigo-500/15 transition">
              <td className="py-3 px-4 font-semibold text-slate-100 whitespace-nowrap">
                <div className="flex items-center gap-2 whitespace-nowrap flex-nowrap">
                  <AvatarDisplay value={userProfile.avatarEmoji} size="md" />
                  <span className="font-bold text-slate-100 whitespace-nowrap">{userProfile.name}</span>
                  <span className="px-2 py-0.5 rounded-full bg-indigo-500/25 text-indigo-300 text-[10px] font-bold border border-indigo-500/50 whitespace-nowrap shrink-0">
                    나 (호스트)
                  </span>
                </div>
              </td>
              <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                <span className="font-medium">{userProfile.role}</span> · <span className="text-slate-400">{userProfile.department}</span>
              </td>
              <td className="py-3 px-4 whitespace-nowrap">
                <span className="px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 uppercase text-[10px] font-bold border border-indigo-500/30">
                  {userProfile.favoriteCli}
                </span>
              </td>
              <td className="py-3 px-4 text-right font-mono text-amber-600 dark:text-amber-300 font-bold whitespace-nowrap">
                {myUsage.rolling5h.toLocaleString()}
              </td>
              <td className="py-3 px-4 text-right font-mono text-slate-100 font-bold whitespace-nowrap">
                {myUsage.weekly.toLocaleString()}
              </td>
              <td className="py-3 px-4 text-center whitespace-nowrap">
                <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Headroom
                  </span>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold border border-indigo-500/30">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    Caveman
                  </span>
                </div>
              </td>
              <td className="py-3 px-4 text-right font-mono text-emerald-400 font-bold whitespace-nowrap">
                -{myUsage.savedPct.toFixed(1)}%
              </td>
              <td className="py-3 px-4 text-right font-mono text-slate-200 whitespace-nowrap">
                ${myUsage.costUsd.toFixed(2)}
              </td>
              <td className="py-3 px-4 text-center whitespace-nowrap">
                <button
                  onClick={openProfileModal}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-indigo-300 text-[11px] font-semibold border border-indigo-500/30 transition shadow-sm active:scale-95"
                  title="내 프로필 수정"
                >
                  수정
                </button>
              </td>
            </tr>

            {/* 2. 등록된 팀원 목록 */}
            {members.map((m) => (
              <tr key={m.memberId} className="hover:bg-slate-800/40 transition">
                <td className="py-3 px-4 font-semibold text-slate-100 whitespace-nowrap">
                  <div className="flex items-center gap-2 whitespace-nowrap flex-nowrap">
                    <AvatarDisplay value={m.avatarEmoji || "🧑‍💻"} size="md" />
                    <span className="truncate max-w-[140px] whitespace-nowrap font-medium">{m.memberName}</span>
                  </div>
                </td>
                <td className="py-3 px-4 text-slate-300 whitespace-nowrap">
                  {m.role} · <span className="text-slate-400">{m.department}</span>
                </td>
                <td className="py-3 px-4 whitespace-nowrap">
                  <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 uppercase text-[10px] font-semibold">
                    {m.favoriteCli}
                  </span>
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-300 whitespace-nowrap">
                  {m.rolling5hTokens.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-200 whitespace-nowrap">
                  {m.weeklyTokens.toLocaleString()}
                </td>
                <td className="py-3 px-4 text-center whitespace-nowrap">
                  <div className="inline-flex items-center gap-1.5 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        m.headroomActive
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30"
                          : "bg-slate-800 text-slate-500 border border-slate-700 font-medium"
                      }`}
                    >
                      {m.headroomActive && <CheckCircle2 className="w-2.5 h-2.5" />}
                      Headroom
                    </span>
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        m.cavemanActive
                          ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30"
                          : "bg-slate-800 text-slate-500 border border-slate-700 font-medium"
                      }`}
                    >
                      {m.cavemanActive && <CheckCircle2 className="w-2.5 h-2.5" />}
                      Caveman
                    </span>
                  </div>
                </td>
                <td className="py-3 px-4 text-right font-mono text-emerald-600 dark:text-emerald-400 font-bold whitespace-nowrap">
                  -{m.savedTokensPct.toFixed(1)}%
                </td>
                <td className="py-3 px-4 text-right font-mono text-slate-100 font-bold whitespace-nowrap">
                  ${m.costUsd.toFixed(2)}
                </td>
                <td className="py-3 px-4 text-center whitespace-nowrap">
                  {onDeleteMember && (
                    <button
                      onClick={() => onDeleteMember(m.memberId)}
                      className="p-1 rounded text-slate-500 hover:text-rose-400 hover:bg-slate-800 transition"
                      title="팀원 삭제"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {members.length === 0 && (
          <div className="py-8 text-center text-xs text-slate-400 bg-slate-950/30">
            현재 호스트 단독 구성입니다. 상단의 <b>[+ 새 팀원 등록]</b> 버튼으로 함께 일하는 동료 팀원을 추가해 보세요.
          </div>
        )}
      </div>

      {/* 새 팀원 추가 모달 */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleAddSubmit}
            className="w-full max-w-md rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl overflow-hidden"
          >
            <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-slate-100">새 팀원 등록</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 rounded text-slate-400 hover:text-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-semibold">이름 *</label>
                  <input
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="예: 김개발, Sarah"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-semibold">역할 / 직무</label>
                  <input
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="예: Backend Engineer"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-semibold">부서 / 팀명</label>
                  <input
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    placeholder="예: Platform Core"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 mb-1 font-semibold">주력 CLI</label>
                  <select
                    value={newCli}
                    onChange={(e) => setNewCli(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                  >
                    <option value="claude">Claude Code (Anthropic)</option>
                    <option value="codex">Codex CLI (OpenAI)</option>
                    <option value="grok">Grok CLI (xAI)</option>
                    <option value="antigravity">Antigravity (Google)</option>
                    <option value="cursor">Cursor Agent CLI</option>
                    <option value="opencode">OpenCode CLI</option>
                  </select>
                </div>
              </div>

              {/* 실시간 사용량 연동 설정 파이프라인 */}
              <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5 text-indigo-400" />
                    토큰 사용량 실시간 연동 소스
                  </span>
                  <span className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                    자동 집계 파이프라인
                  </span>
                </div>

                {/* 연동 방식 선택 탭 */}
                <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-800 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setNewConnectType("workspace")}
                    className={`py-1.5 px-2 rounded-md font-semibold transition ${
                      newConnectType === "workspace"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    📁 작업 폴더
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewConnectType("apikey")}
                    className={`py-1.5 px-2 rounded-md font-semibold transition ${
                      newConnectType === "apikey"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🔑 계정 / 키 매핑
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewConnectType("endpoint")}
                    className={`py-1.5 px-2 rounded-md font-semibold transition ${
                      newConnectType === "endpoint"
                        ? "bg-indigo-600 text-white shadow-sm"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    🌐 원격 동기화
                  </button>
                </div>

                {/* 연동 대상 입력창 */}
                <div>
                  <label className="block text-[11px] text-slate-400 mb-1">
                    {newConnectType === "workspace" && "팀원의 프로젝트 작업 디렉토리 또는 CLI 세션 로그 경로"}
                    {newConnectType === "apikey" && "팀원 전용 CLI API 키 접두사 또는 계정 식별자"}
                    {newConnectType === "endpoint" && "팀 사용량 공유 JSON 엔드포인트 URL"}
                  </label>
                  <input
                    value={newConnectTarget}
                    onChange={(e) => setNewConnectTarget(e.target.value)}
                    placeholder={
                      newConnectType === "workspace"
                        ? "예: C:\\Users\\team_member\\Develop 또는 ~/.claude"
                        : newConnectType === "apikey"
                        ? "예: sk-ant-api03-... 또는 member_dev01"
                        : "예: http://internal-server:8788/team-usage.json"
                    }
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-100 text-xs font-mono placeholder:text-slate-600 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="flex items-center justify-between pt-1 text-[11px]">
                  <span className="text-slate-400">주간 권장 토큰 한도:</span>
                  <div className="flex items-center gap-1.5">
                    {["250k", "500k", "1M", "2M"].map((limit) => (
                      <button
                        key={limit}
                        type="button"
                        onClick={() => setNewQuotaLimit(limit)}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold transition border ${
                          newQuotaLimit === limit
                            ? "bg-indigo-600/30 border-indigo-500 text-indigo-300"
                            : "bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        {limit}
                      </button>
                    ))}
                  </div>
                </div>

                <p className="text-[10px] text-slate-500 leading-relaxed">
                  💡 등록 시 지정된 작업 폴더/계정의 CLI 세션 실행 로그를 백그라운드에서 실시간 집계하여 팀 대시보드에 자동 반영합니다.
                </p>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="px-3.5 py-1.5 rounded-lg bg-slate-800 text-slate-300 text-xs hover:bg-slate-700 transition"
              >
                취소
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition shadow"
              >
                등록 완료
              </button>
            </div>
          </form>
        </div>
      )}

      {/* 내 프로필 설정 모달 (아바타 이모지 카테고리 60여 종 + 커스텀 이미지 파일 업로드 지원) */}
      {showProfileModal && (
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
                onClick={() => setShowProfileModal(false)}
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
                  {/* 숨겨진 파일 인풋 */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    className="hidden"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
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
                <select
                  value={profCli}
                  onChange={(e) => setProfCli(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 focus:outline-none focus:border-indigo-500"
                >
                  <option value="claude">Claude Code (Anthropic)</option>
                  <option value="codex">Codex CLI (OpenAI)</option>
                  <option value="grok">Grok CLI (xAI)</option>
                  <option value="antigravity">Antigravity (Google)</option>
                  <option value="cursor">Cursor Agent CLI</option>
                  <option value="opencode">OpenCode CLI</option>
                </select>
              </div>
            </div>

            <div className="px-5 py-3.5 bg-slate-950 border-t border-slate-800 flex justify-end gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setShowProfileModal(false)}
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
      )}
    </div>
  );
};