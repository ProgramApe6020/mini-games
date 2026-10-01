/**
 * 游戏逻辑的单元测试（纯函数，不涉及 DOM）。
 *
 * 运行方式：npm test
 * 这份文件用的是 Node 内置测试运行器，Node 22.6 以上可以直接执行 .ts 文件，
 * 所以不需要额外安装 Jest / Vitest。
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIZE,
  addRandomTile,
  canMove,
  createGame,
  maxValue,
  move,
  resetTileIds,
  type Tile,
} from '../src/games/g2048/logic.ts';

import {
  COLS,
  ROWS,
  advance,
  createState,
  queueDirection,
  spawnFood,
  togglePause,
} from '../src/games/snake/logic.ts';

/** 用「每行一个数组」的简写造棋盘，0 表示空格。 */
function board(rows: number[][]): Tile[] {
  resetTileIds();
  const tiles: Tile[] = [];
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== 0) tiles.push({ id: r * SIZE + c + 1, value, r, c });
    });
  });
  return tiles;
}

/** 把棋盘还原成「每行一个数组」，并按数值排序后输出，方便断言。 */
function snapshot(tiles: Tile[]): number[][] {
  const grid: number[][] = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
  for (const tile of tiles) grid[tile.r]![tile.c] = tile.value;
  return grid;
}

/** 各行的非零数字，用来只比较「合并结果」而不关心落点细节。 */
function nonZero(tiles: Tile[]): number[][] {
  return snapshot(tiles).map((row) => row.filter((value) => value !== 0));
}

test('2048：向左合并相同的数字', () => {
  const tiles = board([
    [2, 2, 4, 4],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  const result = move(tiles, 'left');

  assert.equal(result.moved, true);
  assert.equal(result.gained, 12);
  assert.deepEqual(nonZero(result.tiles), [[4, 8], [], [], []]);
});

test('2048：同一个方块一回合只能合并一次', () => {
  const tiles = board([
    [2, 2, 2, 2],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  const result = move(tiles, 'left');

  assert.deepEqual(nonZero(result.tiles), [[4, 4], [], [], []]);
  assert.equal(result.gained, 8);
});

test('2048：三个相同数字靠边合并（[2,2,2] -> [4,2]）', () => {
  const tiles = board([
    [2, 2, 2, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);

  const result = move(tiles, 'left');

  assert.deepEqual(nonZero(result.tiles), [[4, 2], [], [], []]);
});

test('2048：向右、向上、向下三个方向的落点正确', () => {
  const right = board([
    [2, 2, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  assert.deepEqual(snapshot(move(right, 'right').tiles)[0], [0, 0, 0, 4]);

  const up = board([
    [4, 0, 0, 0],
    [4, 0, 0, 0],
    [8, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const upResult = snapshot(move(up, 'up').tiles);
  assert.equal(upResult[0]![0], 8);
  assert.equal(upResult[1]![0], 8);
  assert.equal(upResult[3]![0], 0);

  const down = board([
    [4, 0, 0, 0],
    [4, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ]);
  const downResult = snapshot(move(down, 'down').tiles);
  assert.equal(downResult[3]![0], 8);
  assert.equal(downResult[2]![0], 0);
});

test('2048：无法移动时 moved 为 false', () => {
  const tiles = board([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);

  for (const dir of ['left', 'right', 'up', 'down'] as const) {
    assert.equal(move(tiles, dir).moved, false, `${dir} 方向不应产生移动`);
  }
  assert.equal(canMove(tiles), false);
});

test('2048：还有空格或存在相邻相同数字时游戏可以继续', () => {
  const withGap = board([
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 0],
  ]);
  assert.equal(canMove(withGap), true);

  const withPair = board([
    [2, 2, 4, 8],
    [4, 8, 16, 32],
    [2, 4, 8, 16],
    [4, 8, 16, 32],
  ]);
  assert.equal(canMove(withPair), true);
});

test('2048：新生成的方块落在空位上，且只增加一个', () => {
  resetTileIds();
  const start = createGame(() => 0.5);
  assert.equal(start.tiles.length, 2);
  assert.equal(start.score, 0);
  for (const tile of start.tiles) {
    assert.ok(tile.value === 2 || tile.value === 4);
    assert.ok(tile.r >= 0 && tile.r < SIZE && tile.c >= 0 && tile.c < SIZE);
  }

  const grown = addRandomTile(start.tiles, () => 0.99);
  assert.equal(grown.length, 3);
  const occupied = new Set(grown.map((tile) => `${tile.r},${tile.c}`));
  assert.equal(occupied.size, 3, '不能有两个方块叠在同一格');
  assert.equal(maxValue(grown), 4);
});

test('贪吃蛇：初始状态和食物位置合法', () => {
  const state = createState();
  assert.equal(state.snake.length, 3);
  assert.equal(state.score, 0);
  assert.equal(state.phase, 'ready');

  const occupied = new Set(state.snake.map((seg) => `${seg.x},${seg.y}`));
  assert.equal(occupied.has(`${state.food.x},${state.food.y}`), false);
  assert.ok(state.food.x >= 0 && state.food.x < COLS);
  assert.ok(state.food.y >= 0 && state.food.y < ROWS);
});

test('贪吃蛇：生成食物会避开蛇身', () => {
  // 只留一个空格，食物必须落在那里
  const snake = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!(x === 19 && y === 19)) snake.push({ x, y });
    }
  }
  const food = spawnFood(snake);
  assert.deepEqual(food, { x: 19, y: 19 });
});

test('贪吃蛇：不能 180° 掉头，也不能重复当前方向', () => {
  const state = createState();
  assert.equal(queueDirection(state, 'left'), false, '向右时不能直接向左');
  assert.equal(queueDirection(state, 'right'), false, '重复当前方向没有意义');
  assert.equal(queueDirection(state, 'up'), true);
  assert.equal(state.phase, 'running', '第一次转向会开始游戏');
});

test('贪吃蛇：吃到食物会变长并加分', () => {
  const state = createState();
  state.phase = 'running';
  const head = state.snake[0]!;
  state.food = { x: head.x + 1, y: head.y };

  const before = state.snake.length;
  advance(state);

  assert.equal(state.snake.length, before + 1);
  assert.equal(state.score, 10);
  assert.equal(state.snake[0]!.x, head.x + 1);
});

test('贪吃蛇：撞墙即结束', () => {
  const state = createState();
  state.phase = 'running';
  state.snake = [
    { x: COLS - 1, y: 5 },
    { x: COLS - 2, y: 5 },
  ];
  state.dir = { x: 1, y: 0 };
  state.queued = [];

  advance(state);
  assert.equal(state.phase, 'over');
});

test('贪吃蛇：咬到自己即结束', () => {
  const state = createState();
  state.phase = 'running';
  // 摆成一个 U 形，向右走会撞到自己的身体
  state.snake = [
    { x: 5, y: 5 },
    { x: 5, y: 6 },
    { x: 4, y: 6 },
    { x: 4, y: 5 },
  ];
  state.dir = { x: 0, y: 1 };
  state.queued = [];
  state.grow = 0;

  advance(state);
  assert.equal(state.phase, 'over');
});

test('贪吃蛇：暂停与继续', () => {
  const state = createState();
  assert.equal(togglePause(state), 'running');
  assert.equal(togglePause(state), 'paused');
  assert.equal(togglePause(state), 'running');
});
