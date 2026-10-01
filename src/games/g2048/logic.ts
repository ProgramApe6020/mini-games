/**
 * 2048 的纯逻辑（不依赖 React，方便单元测试）。
 *
 * 一个关键约定：把四个方向都转换成「朝一侧合并」的同一种情况来处理 ——
 * 通过 toLine / fromLine 做坐标变换，向左、向右、向上、向下就只需要一份合并代码。
 */

export type Dir = 'up' | 'down' | 'left' | 'right';

export type Tile = {
  id: number;
  value: number;
  r: number;
  c: number;
  /** 本回合新生成，用于弹入动画 */
  isNew?: boolean;
  /** 本回合由两个方块合并而来，用于合并动画 */
  merged?: boolean;
};

export type Pos = { r: number; c: number };

export const SIZE = 4;
export const WIN_VALUE = 2048;

let nextId = 1;

export function resetTileIds(): void {
  nextId = 1;
}

function makeTile(value: number, r: number, c: number, flags: { isNew?: boolean; merged?: boolean } = {}): Tile {
  nextId += 1;
  return { id: nextId, value, r, c, ...flags };
}

/** 去掉上一回合遗留的动画标记，保留 id 以便 DOM 元素复用（滑动动画依赖这一点）。 */
function carry(tile: Tile, r: number, c: number): Tile {
  return { id: tile.id, value: tile.value, r, c };
}

export function emptyCells(tiles: Tile[]): Pos[] {
  const taken = new Set(tiles.map((tile) => `${tile.r},${tile.c}`));
  const free: Pos[] = [];
  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      if (!taken.has(`${r},${c}`)) free.push({ r, c });
    }
  }
  return free;
}

/** 在随机空位生成一个新方块（90% 是 2，10% 是 4）。 */
export function addRandomTile(tiles: Tile[], rand: () => number = Math.random): Tile[] {
  const base = tiles.map((tile) => carry(tile, tile.r, tile.c));
  const free = emptyCells(base);
  if (free.length === 0) return base;
  const spot = free[Math.floor(rand() * free.length)]!;
  const value = rand() < 0.9 ? 2 : 4;
  return [...base, makeTile(value, spot.r, spot.c, { isNew: true })];
}

/** 把棋盘坐标映射到「行号 + 该行内从落点开始的下标」。 */
function toLine(pos: Pos, dir: Dir): { line: number; idx: number } {
  switch (dir) {
    case 'left':
      // 向左侧堆积：idx 越小越靠左
      return { line: pos.r, idx: pos.c };
    case 'right':
      // 向右侧堆积：idx 0 对应最右列
      return { line: pos.r, idx: SIZE - 1 - pos.c };
    case 'up':
      // 向上方堆积：idx 0 对应第一行
      return { line: pos.c, idx: pos.r };
    case 'down':
      // 向下方堆积：idx 0 对应最后一行
      return { line: pos.c, idx: SIZE - 1 - pos.r };
  }
}

function fromLine(line: number, idx: number, dir: Dir): Pos {
  switch (dir) {
    case 'left':
      return { r: line, c: idx };
    case 'right':
      return { r: line, c: SIZE - 1 - idx };
    case 'up':
      return { r: idx, c: line };
    case 'down':
      return { r: SIZE - 1 - idx, c: line };
  }
}

export type MoveResult = {
  /** 移动 + 合并后的棋盘（注意：不含新生成的方块，生成与否由调用方决定） */
  tiles: Tile[];
  gained: number;
  /** 棋盘是否真的发生了变化 */
  moved: boolean;
};

export function move(tiles: Tile[], dir: Dir): MoveResult {
  const out: Tile[] = [];
  let gained = 0;
  let moved = false;

  for (let line = 0; line < SIZE; line += 1) {
    const inLine = tiles
      .map((tile) => ({ tile, ...toLine(tile, dir) }))
      .filter((entry) => entry.line === line)
      .sort((a, b) => a.idx - b.idx);

    let writeIdx = 0;
    let i = 0;
    while (i < inLine.length) {
      const current = inLine[i]!;
      const next = inLine[i + 1];

      if (next && next.tile.value === current.tile.value) {
        // 合并：两个方块消失，在落点生成一个双倍数值的方块
        const pos = fromLine(line, writeIdx, dir);
        out.push(makeTile(current.tile.value * 2, pos.r, pos.c, { merged: true }));
        gained += current.tile.value * 2;
        moved = true;
        writeIdx += 1;
        i += 2;
      } else {
        const pos = fromLine(line, writeIdx, dir);
        if (current.tile.r !== pos.r || current.tile.c !== pos.c) moved = true;
        out.push(carry(current.tile, pos.r, pos.c));
        writeIdx += 1;
        i += 1;
      }
    }
  }

  return { tiles: out, gained, moved };
}

/** 还有没有可走的步：有空格，或存在相邻的相同数字。 */
export function canMove(tiles: Tile[]): boolean {
  if (tiles.length < SIZE * SIZE) return true;

  const grid: number[][] = Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
  for (const tile of tiles) grid[tile.r]![tile.c] = tile.value;

  for (let r = 0; r < SIZE; r += 1) {
    for (let c = 0; c < SIZE; c += 1) {
      const value = grid[r]![c]!;
      if (c + 1 < SIZE && grid[r]![c + 1] === value) return true;
      if (r + 1 < SIZE && grid[r + 1]![c] === value) return true;
    }
  }
  return false;
}

export function maxValue(tiles: Tile[]): number {
  return tiles.reduce((max, tile) => Math.max(max, tile.value), 0);
}

/** 新开一局：两个起始方块 + 0 分。 */
export function createGame(rand: () => number = Math.random): { tiles: Tile[]; score: number } {
  const tiles = addRandomTile(addRandomTile([], rand), rand);
  return { tiles, score: 0 };
}
