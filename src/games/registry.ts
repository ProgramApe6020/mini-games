/**
 * 游戏清单：首页卡片、页面标题、操作提示都从这里读。
 * 新增游戏只要在这里加一条，再到 App.tsx 里注册组件即可。
 */
export type GameCategory = 'solo' | 'duel';

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
  /** solo = 单人闯关；duel = 双人联机对战 */
  category: GameCategory;
  /** 联机游戏：一局大概多久 / 胜负条件，显示在卡片上 */
  duelNote?: string;
};

export const GAMES: GameMeta[] = [
  // ---------- 单人 ----------
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
    category: 'solo',
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
    category: 'solo',
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
    category: 'solo',
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
    category: 'solo',
  },

  // ---------- 双人联机 ----------
  {
    id: 'tictactoe',
    title: '井字棋对决',
    subtitle: 'Tic-Tac-Toe',
    emoji: '⭕',
    tagline: '三子连线就赢，最快的一局。',
    accent: '#f472b6',
    controls: '点击格子落子 · 双方轮流 · 房间码邀请对手',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '回合制 · 一局约 1 分钟',
  },
  {
    id: 'gomoku',
    title: '五子棋对决',
    subtitle: 'Gomoku',
    emoji: '⚫',
    tagline: '15×15 棋盘，先连成五子者胜。',
    accent: '#38bdf8',
    controls: '点击棋盘落子 · 双方轮流 · 房间码邀请对手',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '回合制 · 一局约 3 分钟',
  },
  {
    id: 'reaction',
    title: '抢答反应对决',
    subtitle: 'Reaction Duel',
    emoji: '⚡',
    tagline: '灯亮的瞬间出手，比谁反应快。',
    accent: '#facc15',
    controls: '看到「点！」立刻按空格或点击 · 抢跑算输 · 五局三胜',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '实时 · 五局三胜 · 约 1 分钟',
  },
  {
    id: 'memory-duel',
    title: '记忆翻牌对战',
    subtitle: 'Memory Duel',
    emoji: '🎴',
    tagline: '轮流翻牌，配对成功可以继续，配对多者胜。',
    accent: '#a78bfa',
    controls: '点击卡片翻开 · 配对成功继续翻 · 配对多者获胜',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '回合制 · 一局约 3 分钟',
  },
  {
    id: 'pong',
    title: '乒乓球对战',
    subtitle: 'Pong Duel',
    emoji: '🏓',
    tagline: '实时对打，先拿 7 分者胜。',
    accent: '#22d3ee',
    controls: '上下移动鼠标 / 触屏拖动控制球拍 · ↑ ↓ 或 W S · 空格发球',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '实时 · 先到 7 分 · 约 2 分钟',
  },
  {
    id: 'snake-duel',
    title: '贪吃蛇对战',
    subtitle: 'Snake Duel',
    emoji: '🐍',
    tagline: '同一块场地抢果实，撞墙或撞到对方就出局。',
    accent: '#34d399',
    controls: '方向键 / WASD 转向 · 先拿 3 分者胜',
    scoreLabel: '得分',
    scoreMode: 'max',
    category: 'duel',
    duelNote: '实时 · 先到 3 分 · 约 3 分钟',
  },
];

export const SOLO_GAMES = GAMES.filter((game) => game.category === 'solo');
export const DUEL_GAMES = GAMES.filter((game) => game.category === 'duel');

export const GAME_BY_ID: Record<string, GameMeta> = Object.fromEntries(
  GAMES.map((game) => [game.id, game]),
);

export function getGame(id: string): GameMeta | undefined {
  return GAME_BY_ID[id];
}
