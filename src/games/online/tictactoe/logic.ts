/**
 * 井字棋的纯逻辑（不依赖 React，便于单元测试）。
 * 棋盘用长度 9 的一维数组表示：0 空、1 玩家 1、2 玩家 2。
 */
import type { Seat } from '../../../lib/net/types';

export type Mark = 0 | 1 | 2;
export type Board = Mark[];

export const BOARD_SIZE = 9;

/** 8 条可能连成三子的线 */
export const LINES: ReadonlyArray<readonly [number, number, number]> = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

export type Outcome =
  | { kind: 'playing' }
  | { kind: 'win'; mark: Mark; line: readonly [number, number, number] }
  | { kind: 'draw' };

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => 0 as Mark);
}

/** 座位号转成棋子标记。 */
export function markFor(seat: Seat): Mark {
  return seat === 0 ? 1 : 2;
}

export function seatOfMark(mark: Mark): Seat | null {
  if (mark === 1) return 0;
  if (mark === 2) return 1;
  return null;
}

/** 判断某个位置是否可以落子。 */
export function canPlay(board: Board, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < BOARD_SIZE && board[index] === 0;
}

/** 落子（不修改原数组；非法位置原样返回）。 */
export function withMove(board: Board, index: number, mark: Mark): Board {
  if (mark === 0 || !canPlay(board, index)) return board;
  const next = board.slice();
  next[index] = mark;
  return next;
}

export function evaluate(board: Board): Outcome {
  for (const line of LINES) {
    const [a, b, c] = line;
    const value = board[a];
    if (value !== 0 && value === board[b] && value === board[c]) {
      return { kind: 'win', mark: value, line };
    }
  }
  return board.every((value) => value !== 0) ? { kind: 'draw' } : { kind: 'playing' };
}
