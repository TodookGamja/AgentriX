import React, { useEffect, useId, useState } from "react";
import { apiListCliModels } from "../lib/tauriBridge";

const STORAGE_KEY = "agentrix_cli_default_models";

// CLI별 기본 실행 모델 (일반 CLI 실행 시 사용, 빈 값 = CLI 자체 기본)
export const getCliDefaultModel = (cliId: string): string => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}")[cliId] || "";
  } catch {
    return "";
  }
};

export const setCliDefaultModel = (cliId: string, model: string) => {
  try {
    const all = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    all[cliId] = model.trim();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {}
};

const modelCache: Record<string, Promise<string[]>> = {};

interface ModelPickerProps {
  cliId: string;
  value: string;
  onChange: (model: string) => void;
  className?: string;
}

/** CLI가 제공하는 모델 목록을 자동완성으로 보여주되 직접 입력도 허용 */
export const ModelPicker: React.FC<ModelPickerProps> = ({ cliId, value, onChange, className }) => {
  const listId = useId();
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    (modelCache[cliId] ??= apiListCliModels(cliId).catch(() => []))
      .then((m) => alive && setModels(m));
    return () => {
      alive = false;
    };
  }, [cliId]);

  return (
    <>
      <input
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={models.length > 0 ? `기본 모델 (예: ${models[0]})` : "기본 모델"}
        className={className}
      />
      <datalist id={listId}>
        {models.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </>
  );
};
