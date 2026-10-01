/**
 * 井字棋逻辑的单元测试。
 * 运行方式：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_SIZE,
  canPlay,
  emptyBoard,
  evaluate,
  markFor,
  seatOfMark,
  withMove,
  type Board,
  type Mark,
} from '../src/games/online/tictactoe/logic.ts';

/** 用字符串画棋盘，方便读：'.' 空、'X' 玩家1、'O' 玩家2。 */
function board(pattern: string): Board {
  const chars = pattern.replace(/[^XO.]/g, '');
  assert.equal(chars.length, BOARD_SIZE, '棋盘必须是 9 格');
  return [...chars].map((ch): Mark => (ch === 'X' ? 1 : ch === 'O' ? 2 : 0));
}

test('井字棋：座位与棋子对应关系', () => {
  assert.equal(markFor(0), 1);
  assert.equal(markFor(1), 2);
  assert.equal(seatOfMark(1), 0);
  assert.equal(seatOfMark(2), 1);
  assert.equal(seatOfMark(0), null);
});

test('井字棋：空棋盘还没结束，落子后可以继续', () => {
  const empty = emptyBoard();
  assert.equal(empty.length, BOARD_SIZE);
  assert.deepEqual(evaluate(empty), { kind: 'playing' });

  const one = withMove(empty, 4, 1);
  assert.equal(one[4], 1);
  assert.equal(empty[4], 0, '原棋盘不应被修改');
  assert.deepEqual(evaluate(one), { kind: 'playing' });
});

test('井字棋：横、竖、斜三种连线都能判胜', () => {
  const horizontal = evaluate(board('XXX......'));
  assert.equal(horizontal.kind, 'win');
  if (horizontal.kind === 'win') {
    assert.equal(horizontal.mark, 1);
    assert.deepEqual([...horizontal.line], [0, 1, 2]);
  }

  const vertical = evaluate(board('O..O..O..'));
  assert.equal(vertical.kind, 'win');
  if (vertical.kind === 'win') assert.equal(vertical.mark, 2);

  const diagonal = evaluate(board('X...X...X'));
  assert.equal(diagonal.kind, 'win');
  if (diagonal.kind === 'win') assert.deepEqual([...diagonal.line], [0, 4, 8]);

  const antiDiagonal = evaluate(board('..O.O.O..'));
  assert.equal(antiDiagonal.kind, 'win');
});

test('井字棋：棋盘填满且没人连线算平局', () => {
  const outcome = evaluate(board('XOXXOOOXX'));
  assert.deepEqual(outcome, { kind: 'draw' });
});

test('井字棋：非法落子会被拒绝', () => {
  const start = board('X........');
  assert.equal(canPlay(start, 0), false, '已有棋子的格子不能落子');
  assert.equal(canPlay(start, -1), false);
  assert.equal(canPlay(start, 9), false);
  assert.equal(canPlay(start, 1.5), false);
  assert.equal(canPlay(start, 1), true);

  assert.equal(withMove(start, 0, 2), start, '重复落子应原样返回');
  assert.equal(withMove(start, 1, 0), start, '空标记不能落子');
});

test('井字棋：对局双方依次落子能走到平局', () => {
  // X:0 O:3 X:1 O:4 X:8 O:2 X:6 O:5 X:7 —— 最后一步填满且无人连线
  let boardState = emptyBoard();
  const moves: Array<[number, Mark]> = [
    [4, 1],
    [0, 2],
    [8, 1],
    [2, 2],
    [1, 1],
    [7, 2],
    [3, 1],
    [5, 2],
    [6, 1],
  ];

  for (const [index, mark] of moves) {
    boardState = withMove(boardState, index, mark);
  }

  assert.ok(boardState.every((value) => value !== 0), '棋盘应被填满');
  assert.deepEqual(evaluate(boardState), { kind: 'draw' });
});
