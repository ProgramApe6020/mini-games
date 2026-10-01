import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'mini-games:bests:v1';

type Bests = Record<string, number>;

function readAll(): Bests {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Bests = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    }
    return out;
  } catch {
    // 隐私模式等场景下 localStorage 可能不可用，静默降级为「没有记录」
    return {};
  }
}

function writeAll(bests: Bests): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bests));
  } catch {
    /* 忽略写入失败 */
  }
}

/**
 * 读取 / 更新某个游戏的最佳成绩，记录保存在浏览器本地。
 * mode = 'max' 时分数越高越好（贪吃蛇、2048、打砖块），
 * mode = 'min' 时数值越小越好（记忆翻牌的步数）。
 */
export function useBestScore(
  id: string,
  mode: 'max' | 'min' = 'max',
): readonly [number | null, (value: number) => boolean] {
  const [best, setBest] = useState<number | null>(null);

  useEffect(() => {
    const value = readAll()[id];
    setBest(typeof value === 'number' ? value : null);
  }, [id]);

  const submit = useCallback(
    (value: number): boolean => {
      const all = readAll();
      const current = all[id];
      const isBetter =
        current === undefined || (mode === 'max' ? value > current : value < current);
      if (!isBetter) return false;
      all[id] = value;
      writeAll(all);
      setBest(value);
      return true;
    },
    [id, mode],
  );

  return [best, submit] as const;
}

/** 清除所有本地成绩记录。 */
export function clearAllBests(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* 忽略 */
  }
}
