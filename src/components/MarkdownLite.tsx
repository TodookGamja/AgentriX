import React from "react";

// 릴리즈 노트용 최소 마크다운: 제목(#~###), 목록(- ), 구분선(---), **굵게**, `코드`, [링크](url)
// 라이브러리/innerHTML 없이 React 요소로만 그려서 노트 내용이 스크립트로 해석될 수 없다.
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|https?:\/\/[^\s)]+)/g;

const renderInline = (text: string): React.ReactNode[] =>
  text.split(INLINE).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
      return <strong key={i} className="font-bold text-slate-50">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
      return <code key={i} className="px-1 rounded bg-slate-800 text-indigo-300 font-mono">{part.slice(1, -1)}</code>;
    const link = /^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/.exec(part);
    const url = link?.[2] ?? (/^https?:\/\//.test(part) ? part : null);
    if (url)
      return <a key={i} href={url} target="_blank" rel="noreferrer noopener" className="text-indigo-400 underline break-all">{link?.[1] ?? part}</a>;
    return part;
  });

export const MarkdownLite: React.FC<{ text: string; className?: string }> = ({ text, className }) => (
  <div className={className}>
    {text.split(/\r?\n/).map((line, i) => {
      const t = line.trim();
      if (!t) return <div key={i} className="h-1.5" />;
      if (/^-{3,}$/.test(t)) return <hr key={i} className="my-2 border-slate-800" />;
      const h = /^(#{1,3})\s+(.*)$/.exec(t);
      if (h)
        return (
          <div key={i} className={h[1].length === 1 ? "mt-2 text-sm font-bold text-slate-50" : h[1].length === 2 ? "mt-2 text-xs font-bold text-slate-50" : "mt-1.5 font-semibold text-indigo-300"}>
            {renderInline(h[2])}
          </div>
        );
      const li = /^[-*]\s+(.*)$/.exec(t);
      if (li)
        return (
          <div key={i} className="flex gap-1.5 pl-1">
            <span className="text-slate-500 shrink-0">•</span>
            <span className="min-w-0">{renderInline(li[1])}</span>
          </div>
        );
      return <div key={i}>{renderInline(t)}</div>;
    })}
  </div>
);
