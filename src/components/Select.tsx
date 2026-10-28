import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: React.ReactNode;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  placeholder?: string;
  /** true면 직접 입력 가능한 콤보박스 (입력값으로 목록 필터링) */
  editable?: boolean;
}

/** 네이티브 <select> 대체: OS 팝업 대신 앱 테마에 맞춘 드롭다운 */
export const Select: React.FC<SelectProps> = ({
  value,
  onChange,
  options,
  className = "",
  placeholder,
  editable,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<React.CSSProperties>({});

  const shown =
    editable && filter
      ? options.filter((o) => o.value.toLowerCase().includes(filter.toLowerCase()))
      : options;
  const selected = options.find((o) => o.value === value);

  const openList = () => {
    setActive(Math.max(0, shown.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const pick = (v: string) => {
    onChange(v);
    setFilter("");
    setOpen(false);
  };

  // 트리거 아래(공간 부족 시 위)에 고정 배치 — 모달의 overflow에 잘리지 않도록 portal 사용
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const up = below < 220 && r.top > below;
    setPos({
      left: r.left,
      minWidth: r.width,
      maxHeight: Math.min(256, (up ? r.top : below) - 12),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }, [open, shown.length]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (!triggerRef.current?.contains(t) && !listRef.current?.contains(t)) setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (!listRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onResize = () => setOpen(false);
    document.addEventListener("mousedown", close);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return openList();
      const d = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(shown.length - 1, Math.max(0, i + d)));
    } else if (e.key === "Enter" || (!editable && e.key === " ")) {
      e.preventDefault();
      if (open && shown[active]) pick(shown[active].value);
      else if (!editable) openList();
      else setOpen(false);
    }
  };

  return (
    <>
      <div
        ref={triggerRef}
        role="combobox"
        aria-expanded={open}
        tabIndex={editable ? -1 : 0}
        onClick={() => (open && !editable ? setOpen(false) : openList())}
        onKeyDown={editable ? undefined : onKeyDown}
        className={`flex items-center gap-2 cursor-pointer select-none focus:outline-none focus:border-indigo-500 ${className}`}
      >
        {editable ? (
          <input
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setFilter(e.target.value);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 min-w-0 bg-transparent border-0 p-0 outline-none text-inherit font-inherit"
          />
        ) : (
          <span className={`flex-1 min-w-0 truncate text-left ${selected ? "" : "text-slate-500"}`}>
            {selected?.label ?? placeholder}
          </span>
        )}
        {options.length > 0 && (
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        )}
      </div>

      {open &&
        shown.length > 0 &&
        createPortal(
          <div
            ref={listRef}
            role="listbox"
            style={pos}
            className="fixed z-[1000] max-w-[min(420px,90vw)] overflow-y-auto p-1 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl shadow-black/40 text-xs"
          >
            {shown.map((o, i) => (
              <div
                key={o.value}
                data-idx={i}
                role="option"
                aria-selected={o.value === value}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
                className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer text-slate-200 ${
                  i === active ? "bg-indigo-500/15 text-slate-50" : ""
                }`}
              >
                <span className="flex-1 truncate">{o.label}</span>
                {o.value === value && <Check className="w-3.5 h-3.5 shrink-0 text-indigo-400" />}
              </div>
            ))}
          </div>,
          document.body
        )}
    </>
  );
};
