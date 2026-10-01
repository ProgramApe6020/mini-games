/**
 * 五子棋逻辑的单元测试。
 * 运行方式：node --test tests/gomoku.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_PX,
  CELL,
  CELLS,
  GRID_PAD,
  SIZE,
  WIN_LENGTH,
  canPlay,
  colOf,
  emptyBoard,
  evaluate,
  indexOf,
  markFor,
  otherSeat,
  pointToIndex,
  rowOf,
  seatOfMark,
  turnForRound,
  withMove,
  withOutcomeScore,
  type Board,
  type Mark,
} from '../src/games/online/gomoku/logic.ts';

type Stone = [row: number, col: number, mark: Mark];

/** 用坐标摆棋盘，比手画 15 行字符串更不容易错位。 */
function boardWith(stones: Stone[]): Board {
  const board = emptyBoard();
  for (const [row, col, mark] of stones) board[indexOf(row, col)] = mark;
  return board;
}

/** 从 (row, col) 出发沿 (dr, dc) 摆 count 个棋子。 */
function run(
  row: number,
  col: number,
  dr: number,
  dc: number,
  count: number,
  mark: Mark,
): Stone[] {
  return Array.from({ length: count }, (_, i) => [row + dr * i, col + dc * i, mark] as Stone);
}

/** 造一个下满但谁也连不成五子的棋盘：横向每 4 列换一次颜色，纵向逐行交换。 */
function fullDrawBoard(): Board {
  const board = emptyBoard();
  for (let row = 0; row < SIZE; row += 1) {
    for (let col = 0; col < SIZE; col += 1) {
      board[indexOf(row, col)] = (Math.floor(col / 4) + row) % 2 === 0 ? 1 : 2;
    }
  }
  return board;
}

test('五子棋：座位、棋子与先手轮换', () => {
  assert.equal(markFor(0), 1, '玩家 1 执黑');
  assert.equal(markFor(1), 2, '玩家 2 执白');
  assert.equal(seatOfMark(1), 0);
  assert.equal(seatOfMark(2), 1);
  assert.equal(seatOfMark(0), null);

  assert.equal(otherSeat(0), 1);
  assert.equal(otherSeat(1), 0);

  assert.equal(turnForRound(0), 0);
  assert.equal(turnForRound(1), 1);
  assert.equal(turnForRound(2), 0);
  assert.equal(turnForRound(3), 1);
  assert.equal(turnForRound(Number.NaN), 0);
});

test('五子棋：棋盘尺寸与「点 -> 交叉点」换算', () => {
  assert.equal(SIZE, 15);
  assert.equal(WIN_LENGTH, 5);
  assert.equal(CELLS, 225);
  assert.equal(BOARD_PX, 480);
  assert.equal(CELL, 30);

  assert.equal(rowOf(0), 0);
  assert.equal(colOf(0), 0);
  assert.equal(rowOf(CELLS - 1), 14);
  assert.equal(colOf(CELLS - 1), 14);
  assert.equal(indexOf(3, 4), 3 * SIZE + 4);
  assert.equal(indexOf(14, 14), CELLS - 1);

  // 交叉点正中
  assert.equal(pointToIndex(GRID_PAD, GRID_PAD), 0);
  assert.equal(pointToIndex(GRID_PAD + 7 * CELL, GRID_PAD + 7 * CELL), indexOf(7, 7));
  assert.equal(pointToIndex(BOARD_PX - GRID_PAD, BOARD_PX - GRID_PAD), CELLS - 1);

  // 偏一点仍算最近的那个交叉点
  assert.equal(pointToIndex(GRID_PAD + 12, GRID_PAD + 12), 0);
  assert.equal(pointToIndex(GRID_PAD + 18, GRID_PAD), indexOf(0, 1));
  assert.equal(pointToIndex(GRID_PAD - 10, GRID_PAD + 4 * CELL), indexOf(4, 0));

  // 棋盘外、非法输入
  assert.equal(pointToIndex(-20, 100), null);
  assert.equal(pointToIndex(100, -20), null);
  assert.equal(pointToIndex(BOARD_PX + 40, 100), null);
  assert.equal(pointToIndex(100, BOARD_PX + 40), null);
  assert.equal(pointToIndex(Number.NaN, 100), null);
  assert.equal(pointToIndex(100, Number.POSITIVE_INFINITY), null);
});

test('五子棋：空棋盘还没结束，落子合法性与不可变性', () => {
  const empty = emptyBoard();
  assert.equal(empty.length, CELLS);
  assert.ok(empty.every((value) => value === 0));
  assert.deepEqual(evaluate(empty), { kind: 'playing' });

  assert.equal(canPlay(empty, 0), true);
  assert.equal(canPlay(empty, CELLS - 1), true);
  assert.equal(canPlay(empty, -1), false);
  assert.equal(canPlay(empty, CELLS), false);
  assert.equal(canPlay(empty, 12.5), false);

  const center = indexOf(7, 7);
  const one = withMove(empty, center, 1);
  assert.equal(one[center], 1);
  assert.equal(empty[center], 0, '原棋盘不应被修改');
  assert.equal(canPlay(one, center), false, '已有棋子的位置不能再落子');
  assert.deepEqual(evaluate(one), { kind: 'playing' });

  assert.equal(withMove(one, center, 2), one, '重复落子应原样返回');
  assert.equal(withMove(empty, 5, 0), empty, '空标记不能落子');
  assert.equal(withMove(empty, CELLS + 3, 1), empty, '越界落子应原样返回');
  assert.equal(withMove(empty, -1, 1), empty);
});

test('五子棋：横、竖、两种斜线都能判胜，并给出连线坐标', () => {
  const horizontal = evaluate(boardWith(run(7, 2, 0, 1, 5, 1)));
  assert.equal(horizontal.kind, 'win');
  if (horizontal.kind === 'win') {
    assert.equal(horizontal.mark, 1);
    assert.deepEqual(
      [...horizontal.line],
      [indexOf(7, 2), indexOf(7, 3), indexOf(7, 4), indexOf(7, 5), indexOf(7, 6)],
    );
  }

  const vertical = evaluate(boardWith(run(0, 3, 1, 0, 5, 2)));
  assert.equal(vertical.kind, 'win');
  if (vertical.kind === 'win') {
    assert.equal(vertical.mark, 2);
    assert.deepEqual(
      [...vertical.line],
      [indexOf(0, 3), indexOf(1, 3), indexOf(2, 3), indexOf(3, 3), indexOf(4, 3)],
    );
  }

  const diagonal = evaluate(boardWith(run(4, 4, 1, 1, 5, 1)));
  assert.equal(diagonal.kind, 'win');
  if (diagonal.kind === 'win') {
    assert.deepEqual(
      [...diagonal.line],
      [indexOf(4, 4), indexOf(5, 5), indexOf(6, 6), indexOf(7, 7), indexOf(8, 8)],
    );
  }

  const antiDiagonal = evaluate(boardWith(run(2, 12, 1, -1, 5, 2)));
  assert.equal(antiDiagonal.kind, 'win');
  if (antiDiagonal.kind === 'win') {
    assert.equal(antiDiagonal.mark, 2);
    assert.deepEqual(
      [...antiDiagonal.line],
      [indexOf(2, 12), indexOf(3, 11), indexOf(4, 10), indexOf(5, 9), indexOf(6, 8)],
    );
  }
});

test('五子棋：棋盘边缘与长连（超过 5 子）也算赢', () => {
  // 第 0 行走满 6 子：起点在棋盘外，仍要能数出来
  const firstRow = evaluate(boardWith(run(0, 0, 0, 1, 6, 1)));
  assert.equal(firstRow.kind, 'win');
  if (firstRow.kind === 'win') assert.equal(firstRow.line.length, 6);

  // 最后一列从底往上竖着 5 子
  const lastCol = evaluate(boardWith(run(14, 14, -1, 0, 5, 2)));
  assert.equal(lastCol.kind, 'win');
  if (lastCol.kind === 'win') {
    assert.equal(lastCol.mark, 2);
    assert.equal(lastCol.line.length, 5);
  }

  // 左下到右上整条对角线的中间一段长连
  const longDiagonal = evaluate(boardWith(run(3, 3, 1, 1, 7, 1)));
  assert.equal(longDiagonal.kind, 'win');
  if (longDiagonal.kind === 'win') assert.equal(longDiagonal.line.length, 7);
});

test('五子棋：四子或被子隔断都不算赢', () => {
  assert.deepEqual(evaluate(boardWith(run(6, 6, 0, 1, 4, 1))), { kind: 'playing' });
  assert.deepEqual(evaluate(boardWith(run(6, 6, 1, 0, 4, 2))), { kind: 'playing' });

  // X X . X X X —— 左边两个、右边三个，中间被空位隔断
  const split = boardWith([...run(5, 1, 0, 1, 2, 1), ...run(5, 4, 0, 1, 3, 1)]);
  assert.deepEqual(evaluate(split), { kind: 'playing' });

  // X X X X O X X X X —— 被对手的棋子隔断
  const blocked = boardWith([
    ...run(9, 0, 0, 1, 4, 1),
    [9, 4, 2],
    ...run(9, 5, 0, 1, 4, 1),
  ]);
  assert.deepEqual(evaluate(blocked), { kind: 'playing' });
});

test('五子棋：棋盘下满且没人连成五子算平局', () => {
  const full = fullDrawBoard();
  assert.ok(full.every((value) => value !== 0), '棋盘应该已经被填满');
  assert.deepEqual(evaluate(full), { kind: 'draw' });
});

test('五子棋：胜局给胜方加一分，进行中/平局不加分', () => {
  const blackWin = boardWith(run(7, 2, 1, 0, 5, 1));
  assert.deepEqual(withOutcomeScore(blackWin, [3, 1]), [4, 1]);
  assert.deepEqual(withOutcomeScore(blackWin, [0, 0]), [1, 0]);

  const whiteWin = boardWith(run(0, 0, 0, 1, 5, 2));
  assert.deepEqual(withOutcomeScore(whiteWin, [3, 1]), [3, 2]);

  assert.deepEqual(withOutcomeScore(emptyBoard(), [3, 1]), [3, 1]);
  assert.deepEqual(withOutcomeScore(fullDrawBoard(), [3, 1]), [3, 1]);

  const scores: [number, number] = [3, 1];
  withOutcomeScore(blackWin, scores);
  assert.deepEqual(scores, [3, 1], '不应修改传入的比分');
});

test('五子棋：模拟一整局，黑棋第 9 手连成五子获胜', () => {
  const moves: Stone[] = [
    [7, 3, 1],
    [7, 4, 2],
    [8, 3, 1],
    [8, 4, 2],
    [9, 3, 1],
    [9, 4, 2],
    [10, 3, 1],
    [10, 4, 2],
    [11, 3, 1],
  ];

  let board = emptyBoard();
  let scores: [number, number] = [0, 0];

  moves.forEach(([row, col, mark], index) => {
    board = withMove(board, indexOf(row, col), mark);
    scores = withOutcomeScore(board, scores);

    const isLast = index === moves.length - 1;
    const outcome = evaluate(board);
    assert.equal(outcome.kind, isLast ? 'win' : 'playing', `第 ${index + 1} 手后的局面不对`);
    assert.deepEqual(scores, isLast ? [1, 0] : [0, 0]);
  });

  const outcome = evaluate(board);
  if (outcome.kind === 'win') {
    assert.equal(outcome.mark, 1);
    assert.deepEqual(
      [...outcome.line],
      [indexOf(7, 3), indexOf(8, 3), indexOf(9, 3), indexOf(10, 3), indexOf(11, 3)],
    );
  }
});
