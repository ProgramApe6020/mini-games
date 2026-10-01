/**
 * 记忆翻牌对战（Memory Duel）的纯逻辑，不依赖 React，方便单元测试。
 *
 * 设计要点：
 * - 牌阵（deck）由房主用种子生成，并通过 state 消息同步给客户端，
 *   两端拿到的是同一份 16 张牌，不需要各自随机。
 * - 所有状态迁移都是确定性的纯函数（`applyFlip` / `settle`），
 *   双方各自对同一个翻牌动作算出同样的结果，所以只需要同步「谁翻了哪张」。
 * - 翻回（配对失败后 900ms）不是消息，而是本地定时器调用 `settle`：
 *   两端延迟相同、输入相同，算出的结果自然也相同。
 * - 房主仍然是权威：客户端进场 / 请求同步 / 一局结束时，房主广播完整快照。
 *
 * 纯逻辑里的相对值导入必须写全 `.ts` 后缀（Node 直接执行 .ts 时需要）；
 * 这里只有 `import type`，编译后会被完全抹掉。
 */
import type { Seat } from '../../../lib/net/types.ts';

/** 4×4 棋盘：16 张牌 = 8 对。 */
export const COLS = 4;
export const ROWS = 4;
export const BOARD_SIZE = COLS * ROWS;
export const PAIRS = BOARD_SIZE / 2;

/** 可选牌面（比 8 对多几个，方便不同局换花样）。 */
export const EMOJI_POOL: readonly string[] = [
  '🍎',
  '🍇',
  '🍉',
  '🍋',
  '🥑',
  '🍒',
  '🍑',
  '🥝',
  '🍍',
  '🌽',
  '🍄',
  '🫐',
];

export type Emoji = string;

/** 一局里两端的公共状态（房主生成、客户端采用）。 */
export type State = {
  /** 长度 16 的牌阵，同一个 emoji 恰好出现两次 */
  deck: Emoji[];
  /** 当前翻开的牌（最多 2 张，按翻开顺序） */
  flipped: number[];
  /** 已经配对成功的牌 */
  matched: number[];
  /** 当前回合的座位 */
  turn: Seat;
  /** 双方得分（配对对数） */
  scores: [number, number];
  /** 第几局，从 0 开始；用来决定谁先手 */
  round: number;
};

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'over'; winner: Seat | null };

/** 对手的座位。 */
export function other(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** 洗牌用的确定性伪随机数：同一个种子一定得到同一个序列。 */
function mulberry32(seed: number): () => number {
  let a = Math.trunc(seed) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 原地 Fisher-Yates 洗牌，随机源可注入，便于测试。 */
function shuffle<T>(items: T[], next: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/**
 * 生成一副牌：从牌面池里选 `PAIRS` 个 emoji，各放两张，再洗牌。
 * 同一个 seed 一定得到同一副牌；默认种子是随机的（房主调用）。
 */
export function createDeck(seed: number = Math.random() * 0xffffffff, pool: readonly Emoji[] = EMOJI_POOL): Emoji[] {
  if (pool.length < PAIRS) {
    throw new Error(`牌面池至少需要 ${PAIRS} 个 emoji`);
  }
  const random = mulberry32(seed);
  const picked = shuffle([...pool], random).slice(0, PAIRS);
  return shuffle([...picked, ...picked], random);
}

/** 开局状态。先手由局数决定：第 0 局玩家 1 先手，第 1 局玩家 2 先手，交替进行。 */
export function freshRound(round: number, scores: [number, number], seed?: number): State {
  return {
    deck: createDeck(seed),
    flipped: [],
    matched: [],
    turn: (Math.abs(Math.trunc(round)) % 2 === 0 ? 0 : 1) as Seat,
    scores: [scores[0], scores[1]],
    round: Math.trunc(round),
  };
}

function validIndex(index: unknown): index is number {
  return typeof index === 'number' && Number.isInteger(index) && index >= 0 && index < BOARD_SIZE;
}

/** 这张牌现在是不是正面朝上（已配对或正被翻开）。 */
export function isRevealed(state: State, index: number): boolean {
  return state.matched.includes(index) || state.flipped.includes(index);
}

/** 这张牌现在能不能被点开。 */
export function canFlip(state: State, seat: Seat, index: number): boolean {
  if (state.turn !== seat) return false;
  if (!validIndex(index)) return false;
  if (isRevealed(state, index)) return false;
  // 两张不同牌摊在桌上（等 900ms 翻回）时，谁都不能再翻
  return !mismatchPending(state);
}

/**
 * 翻开一张牌。非法操作（不是自己回合 / 越界 / 已翻开 / 已配对 / 正在翻回）
 * 原样返回同一个对象引用，调用方可以用 `next === prev` 判断被拒绝。
 *
 * 这里只负责「翻牌 + 配对判定 + 得分 + 换手」，
 * 配对失败后的翻回由 `settle` 负责（两端各自的定时器触发）。
 *
 * 写成泛型是为了让调用方自己扩展的状态字段（例如「谁配成了这张」的痕迹）
 * 在返回值里保留下来；返回类型仍是调用方传进来的那个类型。
 */
export function applyFlip<T extends State>(state: T, seat: Seat, index: number): T {
  if (!canFlip(state, seat, index)) return state;

  const flipped = [...state.flipped, index];
  if (flipped.length < 2) return { ...state, flipped } as unknown as T;

  const first = flipped[0]!;
  const second = flipped[1]!;
  if (state.deck[first] !== state.deck[second]) {
    // 没配上：先让两张牌摊着（等定时器翻回），回合暂时不动
    return { ...state, flipped } as unknown as T;
  }

  // 配对成功：记分，并且可以继续翻
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  scores[seat] += 1;
  return {
    ...state,
    flipped: [],
    matched: [...state.matched, first, second],
    scores,
  } as unknown as T;
}

/** 桌上是不是摆着两张配不上的牌（等待翻回）。 */
export function mismatchPending(state: State): boolean {
  if (state.matched.length >= BOARD_SIZE) return false;
  if (state.flipped.length !== 2) return false;
  const [first, second] = state.flipped as [number, number];
  return state.deck[first] !== state.deck[second];
}

/** 定时器到点时能不能翻回。 */
export function canSettle(state: State): boolean {
  return mismatchPending(state);
}

/**
 * 配对失败后的「翻回」：收走两张明牌并把回合交给对方。
 * - 合法时返回 `{ ...state }`，所以调用方自己扩展的字段（例如痕迹）会保留；
 * - 不合法时原样返回同一引用，调用方可以用 `next === prev` 判断被拒绝。
 */
export function settle<T extends State>(state: T): T {
  if (!canSettle(state)) return state;
  return { ...state, flipped: [], turn: other(state.turn) };
}

/** 对局状态：还在进行 / 已结束（附胜负）。 */
export function evaluate(state: State): Outcome {
  if (state.matched.length < BOARD_SIZE) return { kind: 'playing' };
  const [a, b] = state.scores;
  return { kind: 'over', winner: a === b ? null : a > b ? 0 : 1 };
}

/** 轮到谁了（对局结束后没有意义）。 */
export function isMyTurn(state: State, seat: Seat): boolean {
  return evaluate(state).kind === 'playing' && state.turn === seat;
}

/**
 * 校验从网络上收到的快照：形状不对就返回 null（直接丢弃）。
 * 联机消息是不可信的输入，宁可丢一帧也不要让渲染崩掉。
 */
export function parseState(input: unknown): State | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = input as Record<string, unknown>;

  const deck = value.deck;
  const flipped = value.flipped;
  const matched = value.matched;
  const scores = value.scores;
  const turn = value.turn;
  const round = value.round;

  if (!Array.isArray(deck) || deck.length !== BOARD_SIZE) return null;
  if (!deck.every((card) => typeof card === 'string')) return null;
  if (!Array.isArray(flipped) || !flipped.every(validIndex)) return null;
  if (flipped.length > 2) return null;
  if (!Array.isArray(matched) || !matched.every(validIndex)) return null;
  if (!Array.isArray(scores) || scores.length !== 2) return null;
  if (!scores.every((score) => typeof score === 'number' && Number.isFinite(score))) return null;
  if (turn !== 0 && turn !== 1) return null;
  if (typeof round !== 'number' || !Number.isFinite(round)) return null;

  return {
    deck: [...(deck as Emoji[])],
    flipped: [...(flipped as number[])],
    matched: [...(matched as number[])],
    turn,
    scores: [scores[0] as number, scores[1] as number],
    round,
  };
}
