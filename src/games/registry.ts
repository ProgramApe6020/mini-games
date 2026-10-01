/**
 * 游戏清单：首页卡片、页面标题、操作提示都从这里读，新增游戏只要在这里加一条。
 */
export type GameMeta = {
  /** 同时也是 hash 路由名，例如 'snake' -> #/snake */
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  tagline: string;
  /** 该游戏的主题色，供 CSS 变量 --accent 使用 */
  accent: string;
  controls: string;
  /** 当前成绩这一栏的标题，例如「得分」「步数」 */
  scoreLabel: string;
  /** 最佳成绩是越大越好还是越小越好 */
  scoreMode: 'max' | 'min';
};

export const GAMES: GameMeta[] = [
  {
    id: 'snake',
    title: '贪吃蛇',
    subtitle: 'Snake',
    emoji: '🐍',
    tagline: '吃果实变长，别撞墙，也别咬到自己。',
    accent: '#4ade80',
    controls: '方向键 / WASD 转向 · 空格暂停 · 手机可滑动屏幕或点方向键',
    scoreLabel: '得分',
    scoreMode: 'max',
  },
  {
    id: '2048',
    title: '2048',
    subtitle: '2048',
    emoji: '🔢',
    tagline: '相同数字撞在一起就合并，目标是凑出 2048。',
    accent: '#fbbf24',
    controls: '方向键 / WASD 移动 · 手机可滑动棋盘 · 支持撤销一步',
    scoreLabel: '得分',
    scoreMode: 'max',
  },
  {
    id: 'breakout',
    title: '打砖块',
    subtitle: 'Breakout',
    emoji: '🧱',
    tagline: '用挡板反弹小球，打光所有砖块进入下一关。',
    accent: '#60a5fa',
    controls: '移动鼠标 / 触屏拖动控制挡板 · ← → 或 A D · 空格发球与暂停',
    scoreLabel: '得分',
    scoreMode: 'max',
  },
  {
    id: 'memory',
    title: '记忆翻牌',
    subtitle: 'Memory',
    emoji: '🃏',
    tagline: '翻开卡片找出所有配对，步数越少越厉害。',
    accent: '#c084fc',
    controls: '点击卡片翻开 · 记住位置，用最少的步数完成',
    scoreLabel: '步数',
    scoreMode: 'min',
  },
];

export const GAME_BY_ID: Record<string, GameMeta> = Object.fromEntries(
  GAMES.map((game) => [game.id, game]),
);

export function getGame(id: string): GameMeta | undefined {
  return GAME_BY_ID[id];
}
