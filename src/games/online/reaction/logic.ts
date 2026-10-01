/**
 * 抢答反应对决的纯逻辑（不依赖 React，便于单元测试）。
 *
 * 玩法：五局三胜。房主每局发一条 `round { roundId, delayMs }`，双方各自
 * 「收到消息后」等 delayMs 看到「点！」，然后尽快出手。因为两边的墙上时钟
 * 不同步，所以只用各自的 `performance.now()` 量相对时间，绝不比较绝对时间戳。
 *
 * 这个文件只放纯函数：判定单局胜者、推进系列赛比分、校验网络消息。
 */

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

/** 先赢几局算赢下整场（五局三胜）。 */
export const WINS_TO_MATCH = 3;

/** 一局最多打到第几局（五局三胜最多五局）。 */
export const ROUNDS_TO_MATCH = WINS_TO_MATCH * 2 - 1;

/** 房主随机等待区间（毫秒）：900~3500，避免双方靠节奏猜。 */
export const DELAY_MIN_MS = 900;
export const DELAY_MAX_MS = 3500;

/** 一次出手合情合理的下限与上限，用来挡掉异常数据。 */
export const MIN_PLAUSIBLE_MS = 40;
export const MAX_PLAUSIBLE_MS = 3000;

/**
 * 出现「点！」之后，房主最多等这么久收结果，超时方判负。
 * 正好等于一次出手的合理上限（MAX_PLAUSIBLE_MS）：比这更慢的出手本来也不算数。
 */
export const RESULT_TIMEOUT_MS = 3000;

/** 每局结果展示多久后进入下一局。 */
export const NEXT_ROUND_DELAY_MS = 1500;

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 座位：0 = 玩家 1（房主），1 = 玩家 2。 */
export type SeatIndex = 0 | 1;

/** 某一局里某个座位的出手结果（网络上的形状，字段都是可选的）。 */
export type RoundResult = {
  /** 观感反应时间（毫秒） */
  ms?: number;
  /** true 表示在「点！」出现前抢跑 */
  falseStart?: boolean;
};

/** 房主对一局的最终判定。 */
export type RoundOutcome = {
  /** 没有胜者：双方都抢跑，或者双方都超时 */
  winner: SeatIndex | null;
  /** 胜负原因，用于界面文案 */
  reason: 'fastest' | 'false-start' | 'timeout' | 'both-false-start' | 'both-timeout';
  /** 两个座位的用时；没出手 / 抢跑 / 超时都是 null */
  times: [number | null, number | null];
};

/** 系列赛比分。 */
export type Series = [number, number];

/** 判定用的结果集：两边都可以还没有结果。 */
export type RoundResults = {
  0?: RoundResult;
  1?: RoundResult;
};

// ---------------------------------------------------------------------------
// 计时
// ---------------------------------------------------------------------------

/**
 * 把「看到点的时间」和「出手时间」换算成毫秒。
 * 出手早于「点！」出现 -> 返回 null，表示抢跑（配合 `isFalseStart` 使用）。
 */
export function reactionMs(goAt: number, pressAt: number): number | null {
  if (!Number.isFinite(goAt) || !Number.isFinite(pressAt)) return null;
  const delta = pressAt - goAt;
  return delta < 0 ? null : Math.round(delta);
}

/** 是否算抢跑：出手时间早于「点！」出现的时刻。 */
export function isFalseStart(goAt: number, pressAt: number): boolean {
  return Number.isFinite(goAt) && Number.isFinite(pressAt) && pressAt < goAt;
}

// ---------------------------------------------------------------------------
// 消息校验
// ---------------------------------------------------------------------------

function isSeatIndex(value: unknown): value is SeatIndex {
  return value === 0 || value === 1;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/** 毫秒数是否像一次真实出手。 */
export function isValidMs(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= MIN_PLAUSIBLE_MS &&
    value <= MAX_PLAUSIBLE_MS
  );
}

/**
 * 校验 `result` 消息。抢跑和正常成绩都合法；两者都不成立时返回 null，
 * 调用方应当忽略这条消息（防止一个坏包把整局判掉）。
 */
export function parseRoundResult(raw: unknown): RoundResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { ms?: unknown; falseStart?: unknown };
  if (data.falseStart === true) return { falseStart: true };
  if (data.falseStart !== undefined && data.falseStart !== false) return null;
  if (isValidMs(data.ms)) return { ms: Math.round(data.ms) };
  return null;
}

/** 胜负原因的取值集合。 */
const REASONS: ReadonlyArray<RoundOutcome['reason']> = [
  'fastest',
  'false-start',
  'timeout',
  'both-false-start',
  'both-timeout',
];

/** 胜负原因：认不出来时退回「比反应」（老版本消息没有这个字段）。 */
export function parseReason(raw: unknown): RoundOutcome['reason'] {
  return REASONS.find((reason) => reason === raw) ?? 'fastest';
}

/** 校验房主广播的 `round-result`。 */
export function parseRoundResultMessage(raw: unknown): {
  roundId: string;
  winner: SeatIndex | null;
  times: [number | null, number | null];
  reason: RoundOutcome['reason'];
} | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { roundId?: unknown; winner?: unknown; times?: unknown; reason?: unknown };
  if (!isNonEmptyString(data.roundId)) return null;
  if (data.winner !== null && !isSeatIndex(data.winner)) return null;

  let times: [number | null, number | null] = [null, null];
  if (Array.isArray(data.times) && data.times.length === 2) {
    times = [
      typeof data.times[0] === 'number' && Number.isFinite(data.times[0]) ? Math.round(data.times[0]) : null,
      typeof data.times[1] === 'number' && Number.isFinite(data.times[1]) ? Math.round(data.times[1]) : null,
    ];
  }

  return { roundId: data.roundId, winner: data.winner, times, reason: parseReason(data.reason) };
}

/** 校验房主广播的 `match-over`。 */
export function parseMatchOver(raw: unknown): { winner: SeatIndex } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as { winner?: unknown };
  return isSeatIndex(data.winner) ? { winner: data.winner } : null;
}

// ---------------------------------------------------------------------------
// 单局判定
// ---------------------------------------------------------------------------

/**
 * 判定一局的胜者。
 *
 * 优先级：
 *   1. 有人抢跑 -> 抢跑者判负（两个人都抢跑则没有人得分）；
 *   2. 剩下的按用时快慢比；
 *   3. 没有合法用时的一方按超时判负；
 *   4. 两边都没有合法用时 -> 没有人得分。
 */
export function judgeRound(results: RoundResults): RoundOutcome {
  const [a, b] = [results[0], results[1]];

  // 1) 抢跑
  if (a?.falseStart && b?.falseStart) {
    return { winner: null, reason: 'both-false-start', times: [null, null] };
  }
  if (a?.falseStart) return { winner: 1, reason: 'false-start', times: [null, null] };
  if (b?.falseStart) return { winner: 0, reason: 'false-start', times: [null, null] };

  const timeA = isValidMs(a?.ms) ? Math.round(a.ms) : null;
  const timeB = isValidMs(b?.ms) ? Math.round(b.ms) : null;
  const times: [number | null, number | null] = [timeA, timeB];

  // 2) 两边都有成绩：快的赢，一样快算平（没有人得分）
  if (timeA !== null && timeB !== null) {
    if (timeA === timeB) return { winner: null, reason: 'fastest', times };
    return { winner: timeA < timeB ? 0 : 1, reason: 'fastest', times };
  }

  // 3) 只有一边有成绩：另一边算超时（或没出手）
  if (timeA !== null) return { winner: 0, reason: 'timeout', times };
  if (timeB !== null) return { winner: 1, reason: 'timeout', times };

  // 4) 两边都没有成绩
  return { winner: null, reason: 'both-timeout', times };
}

/** 从一局的原始结果里取出双方用时，供界面展示「你 320ms / 对手 280ms」。 */
export function timesFrom(results: RoundResults): [number | null, number | null] {
  const pick = (result: RoundResult | undefined): number | null =>
    isValidMs(result?.ms) ? Math.round(result.ms) : null;
  return [pick(results[0]), pick(results[1])];
}

/** 按座位取用时。 */
export function timeForSeat(times: [number | null, number | null], seat: SeatIndex): number | null {
  return times[seat] ?? null;
}

/** 胜者 / 败者用时，用于结果文案。 */
export function timesFor(
  times: [number | null, number | null],
  winner: SeatIndex | null,
): { winnerTime: number | null; loserTime: number | null } {
  if (winner === null) return { winnerTime: null, loserTime: null };
  const loser: SeatIndex = winner === 0 ? 1 : 0;
  return { winnerTime: times[winner], loserTime: times[loser] };
}

/** 中文胜负文案（从胜者视角）。 */
export function winnerText(reason: RoundOutcome['reason']): string {
  switch (reason) {
    case 'fastest':
      return '反应更快，赢下这一局';
    case 'false-start':
      return '对方抢跑，这一局归你';
    case 'timeout':
      return '对方没出手，这一局归你';
    case 'both-false-start':
      return '双方都抢跑，这一局没人得分';
    case 'both-timeout':
      return '双方都没出手，这一局没人得分';
    default:
      return '';
  }
}

// ---------------------------------------------------------------------------
// 系列赛
// ---------------------------------------------------------------------------

export function emptySeries(): Series {
  return [0, 0];
}

/** 给某个座位加一胜（不修改原数组）。 */
export function addWin(series: Series, winner: SeatIndex): Series {
  const next: Series = [series[0], series[1]];
  next[winner] += 1;
  return next;
}

/** 一局判定结算到系列赛比分上。 */
export function applyOutcome(series: Series, outcome: RoundOutcome): Series {
  return outcome.winner === null ? [series[0], series[1]] : addWin(series, outcome.winner);
}

/** 是否已经有人赢下整场。 */
export function matchWinner(series: Series): SeatIndex | null {
  if (series[0] >= WINS_TO_MATCH) return 0;
  if (series[1] >= WINS_TO_MATCH) return 1;
  return null;
}

/** 下一局在整场里的序号（从 1 开始，用于展示「第 N 局」）。 */
export function nextRoundOrdinal(series: Series): number {
  return series[0] + series[1] + 1;
}

/** 五局三胜最多打 5 局。 */
export function roundsUpperBound(): number {
  return ROUNDS_TO_MATCH;
}

// ---------------------------------------------------------------------------
// 杂项
// ---------------------------------------------------------------------------

/** 生成一局的唯一 id，避免旧消息被当成新一局处理。 */
export function upcomingRoundId(matchNumber: number, roundOrdinal: number): string {
  return `m${matchNumber}r${roundOrdinal}`;
}

/** 随机等待时长（含两端），用于房主决定「点！」什么时候出现。 */
export function randomDelayMs(): number {
  return DELAY_MIN_MS + Math.floor(Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS + 1));
}

export function clampDelayMs(value: number): number {
  if (!Number.isFinite(value)) return DELAY_MIN_MS;
  return Math.min(DELAY_MAX_MS, Math.max(DELAY_MIN_MS, Math.round(value)));
}

/** 成绩文案：有效返回「320ms」，其余按原因返回「抢跑」「超时」「—」。 */
export function formatMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  return `${Math.round(ms)}ms`;
}

export function formatResult(result: RoundResult | undefined): string {
  if (!result) return '—';
  if (result.falseStart) return '抢跑';
  return formatMs(result.ms);
}
