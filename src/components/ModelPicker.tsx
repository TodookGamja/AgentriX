import React, { useEffect, useState } from "react";
import { apiListCliModels } from "../lib/tauriBridge";
import { Select } from "./Select";

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

// 모델 목록은 24시간 디스크 캐시: 매 실행마다 `cursor-agent models` 등을 띄우면 CLI 내부 cscript 때문에 콘솔창이 깜빡임
const MODELS_TTL = 24 * 60 * 60 * 1000;
const readModels = (cliId: string): string[] | null => {
  try {
    const c = JSON.parse(localStorage.getItem(`agentrix_models_${cliId}`) || "null");
    return c && Date.now() - c.at < MODELS_TTL && c.models.length > 0 ? c.models : null;
  } catch {
    return null;
  }
};

/** 모델 목록 조회 (빈 결과·실패는 캐시하지 않아 다음에 다시 시도) */
export const loadCliModels = (cliId: string): Promise<string[]> => {
  const cached = readModels(cliId);
  if (cached) return Promise.resolve(cached);
  return (modelCache[cliId] ??= apiListCliModels(cliId).catch(() => [])).then((m) => {
    if (m.length === 0) delete modelCache[cliId];
    else localStorage.setItem(`agentrix_models_${cliId}`, JSON.stringify({ at: Date.now(), models: m }));
    return m;
  });
};

interface ModelPickerProps {
  cliId: string;
  value: string;
  onChange: (model: string) => void;
  className?: string;
}

/** CLI가 제공하는 모델 목록을 드롭다운으로 보여주되 직접 입력도 허용 */
export const ModelPicker: React.FC<ModelPickerProps> = ({ cliId, value, onChange, className }) => {
  const [models, setModels] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    loadCliModels(cliId).then((m) => alive && setModels(m));
    return () => {
      alive = false;
    };
  }, [cliId]);

  return (
    <Select
      editable
      value={value}
      onChange={onChange}
      options={models.map((m) => ({ value: m, label: m }))}
      placeholder={models.length > 0 ? `기본 모델 (예: ${models[0]})` : "기본 모델 (직접 입력)"}
      className={className}
    />
  );
};
