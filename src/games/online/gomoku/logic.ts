/**
 * 五子棋的纯逻辑（不依赖 React，便于单元测试）。
 *
 * 棋盘用长度 225 的一维数组表示，按行优先排列：
 * index = row * SIZE + col；0 空、1 玩家 1（黑）、2 玩家 2（白）。
 *
 * 这里还导出棋盘在画布上的几何常量与「点 -> 格」的换算，
 * 这样组件只管画，坐标换算也能被单元测试覆盖。
 */
import type { Seat } from '../../../lib/net/types';

export type Mark = 0 | 1 | 2;
export type Board = Mark[];

/** 棋盘边长：15×15。 */
export const SIZE = 15;
/** 连成几子算赢（5 子或更长都算）。 */
export const WIN_LENGTH = 5;
/** 交叉点总数。 */
export const CELLS = SIZE * SIZE;

/** 画布的逻辑边长，实际显示大小交给 CSS 缩放。 */
export const BOARD_PX = 480;
/** 网格四周的留白（像素）。 */
export const GRID_PAD = 30;
/** 相邻两条线的间距：(480 - 30 * 2) / (15 - 1) = 30。 */
export const CELL = (BOARD_PX - GRID_PAD * 2) / (SIZE - 1);

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'win'; mark: Mark; line: readonly number[] }
  | { kind: 'draw' };

export function emptyBoard(): Board {
  return Array.from({ length: CELLS }, () => 0 as Mark);
}

/** 座位号转成棋子标记：玩家 1 执黑，玩家 2 执白。 */
export function markFor(seat: Seat): Mark {
  return seat === 0 ? 1 : 2;
}

export function seatOfMark(mark: Mark): Seat | null {
  if (mark === 1) return 0;
  if (mark === 2) return 1;
  return null;
}

export function otherSeat(seat: Seat): Seat {
  return seat === 0 ? 1 : 0;
}

/** 第 round 局的先手（黑）归谁：每局轮换，两端用同一个函数算，结果必然一致。 */
export function turnForRound(round: number): Seat {
  const safe = Number.isFinite(round) ? Math.abs(Math.trunc(round)) : 0;
  return (safe % 2) as Seat;
}

export function indexOf(row: number, col: number): number {
  return row * SIZE + col;
}

export function rowOf(index: number): number {
  return Math.floor(index / SIZE);
}

export function colOf(index: number): number {
  return index % SIZE;
}

export function inBounds(row: number, col: number): boolean {
  return Number.isInteger(row) && Number.isInteger(col) && row >= 0 && row < SIZE && col >= 0 && col < SIZE;
}

/** 把画布上的逻辑坐标换算成最近的交叉点；落在棋盘外返回 null。 */
export function pointToIndex(x: number, y: number): number | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const col = Math.round((x - GRID_PAD) / CELL);
  const row = Math.round((y - GRID_PAD) / CELL);
  return inBounds(row, col) ? indexOf(row, col) : null;
}

/** 判断某个位置是否可以落子。 */
export function canPlay(board: Board, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < CELLS && board[index] === 0;
}

/** 落子（不修改原数组；非法位置原样返回）。 */
export function withMove(board: Board, index: number, mark: Mark): Board {
  if (mark === 0 || !canPlay(board, index)) return board;
  const next = board.slice();
  next[index] = mark;
  return next;
}

/** 四个方向：横、竖、右下、左下。 */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

/**
 * 判断当前局面：有人连成 5 子或更多就赢，棋盘下满且无人连成算平局。
 * 返回的 line 是完整的一串（长连时长度会大于 5），按行优先扫描取第一串。
 */
export function evaluate(board: Board): Outcome {
  let filled = 0;

  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      const mark = board[indexOf(row, col)] as Mark | undefined;
      if (!mark) continue; // 空位（或数据不完整）跳过
      filled += 1;

      for (const [dr, dc] of DIRECTIONS) {
        const prevRow = row - dr;
        const prevCol = col - dc;
        // 只从一串的起点开始数，避免重复统计
        if (inBounds(prevRow, prevCol) && board[indexOf(prevRow, prevCol)] === mark) continue;

        const line: number[] = [indexOf(row, col)];
        let r = row + dr;
        let c = col + dc;
        while (inBounds(r, c) && board[indexOf(r, c)] === mark) {
          line.push(indexOf(r, c));
          r += dr;
          c += dc;
        }

        if (line.length >= WIN_LENGTH) return { kind: 'win', mark, line };
      }
    }
  }

  return filled === CELLS ? { kind: 'draw' } : { kind: 'playing' };
}

/**
 * 依据棋盘结果更新比分（返回新数组，不修改入参）。
 * 只有分出胜负才加分，平局和进行中都原样返回。
 */
export function withOutcomeScore(board: Board, scores: readonly [number, number]): [number, number] {
  const next: [number, number] = [scores[0], scores[1]];
  const outcome = evaluate(board);
  if (outcome.kind === 'win') next[outcome.mark === 1 ? 0 : 1] += 1;
  return next;
}
