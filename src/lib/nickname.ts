/** 昵称：存本地，作为联机时队友看到的名字。 */
const KEY = 'dungeon:nickname';
const DEFAULT_NAME = '冒险者';

export function loadNickname(): string {
  try {
    const saved = window.localStorage.getItem(KEY);
    if (saved && saved.trim().length > 0) return saved.trim().slice(0, 10);
  } catch {
    /* 隐私模式下读不到就用默认值 */
  }
  return `${DEFAULT_NAME}${Math.floor(Math.random() * 90 + 10)}`;
}

export function saveNickname(name: string): void {
  try {
    const clean = name.trim().slice(0, 10);
    if (clean.length > 0) window.localStorage.setItem(KEY, clean);
  } catch {
    /* 忽略写入失败 */
  }
}
