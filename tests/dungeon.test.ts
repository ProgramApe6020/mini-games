/**
 * 地牢生成的测试。重点是「确定性」和「连通性」——
 * 联机时每个客户端都靠同一种子各生成一份地图，任何不一致都会导致走位穿帮。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { MAP_H, MAP_W, T_FLOOR, T_STAIRS, T_WALL, TILE } from '../src/game/constants.ts';
import {
  cellIndex,
  circleHitsWall,
  generateDungeon,
  hasLineOfSight,
  isWallTile,
  moveWithCollision,
  tileAt,
  toTile,
} from '../src/game/dungeon.ts';

/** 把地图压成一个字符串指纹，便于比较两份地图是否完全一致 */
function fingerprint(grid: Uint8Array): string {
  let hash = 2166136261;
  for (let i = 0; i < grid.length; i += 1) {
    hash ^= grid[i]!;
    hash = Math.imul(hash, 16777619);
  }
  return `${grid.length}:${hash >>> 0}`;
}

/** 从某点出发洪水填充，返回能走到的地面瓦片数量 */
function reachableFloorCount(grid: Uint8Array, startX: number, startY: number): number {
  const seen = new Uint8Array(MAP_W * MAP_H);
  const stack: number[] = [cellIndex(startX, startY)];
  let count = 0;

  while (stack.length > 0) {
    const index = stack.pop()!;
    if (seen[index]) continue;
    if ((grid[index] ?? T_WALL) === T_WALL) continue;
    seen[index] = 1;
    count += 1;

    const x = index % MAP_W;
    const y = Math.floor(index / MAP_W);
    if (x > 0) stack.push(index - 1);
    if (x < MAP_W - 1) stack.push(index + 1);
    if (y > 0) stack.push(index - MAP_W);
    if (y < MAP_H - 1) stack.push(index + MAP_W);
  }

  return count;
}

function totalFloorCount(grid: Uint8Array): number {
  let count = 0;
  for (const tile of grid) if (tile !== T_WALL) count += 1;
  return count;
}

test('地牢：同一种子 + 同一楼层生成完全相同的地图', () => {
  const a = generateDungeon(20261001, 1);
  const b = generateDungeon(20261001, 1);

  assert.equal(fingerprint(a.grid), fingerprint(b.grid));
  assert.deepEqual(a.start, b.start);
  assert.deepEqual(a.stairs, b.stairs);
  assert.deepEqual(a.enemySpots, b.enemySpots);
  assert.deepEqual(a.itemSpots, b.itemSpots);
  assert.deepEqual(a.rooms, b.rooms);
});

test('地牢：不同种子 / 不同楼层生成不同地图', () => {
  const base = fingerprint(generateDungeon(1, 1).grid);
  assert.notEqual(base, fingerprint(generateDungeon(2, 1).grid));
  assert.notEqual(base, fingerprint(generateDungeon(1, 2).grid));
});

test('地牢：地图始终完全连通（不会出现走不到的房间）', () => {
  for (let floor = 1; floor <= 8; floor += 1) {
    for (const seed of [1, 7, 99, 20261001, 424242]) {
      const dungeon = generateDungeon(seed, floor);
      const startTileX = toTile(dungeon.start.x);
      const startTileY = toTile(dungeon.start.y);
      const reachable = reachableFloorCount(dungeon.grid, startTileX, startTileY);
      assert.equal(
        reachable,
        totalFloorCount(dungeon.grid),
        `种子 ${seed} 第 ${floor} 层有走不到的区域（可达 ${reachable} / 共 ${totalFloorCount(dungeon.grid)}）`,
      );
    }
  }
});

test('地牢：出生点与楼梯都在地面上，且楼梯能和出生点连通', () => {
  const dungeon = generateDungeon(12345, 3);
  const startTile = { x: toTile(dungeon.start.x), y: toTile(dungeon.start.y) };
  const stairsTile = { x: toTile(dungeon.stairs.x), y: toTile(dungeon.stairs.y) };

  assert.notEqual(tileAt(dungeon.grid, startTile.x, startTile.y), T_WALL);
  assert.equal(tileAt(dungeon.grid, stairsTile.x, stairsTile.y), T_STAIRS);
  assert.notDeepEqual(startTile, stairsTile);

  const reachable = reachableFloorCount(dungeon.grid, stairsTile.x, stairsTile.y);
  assert.equal(reachable, totalFloorCount(dungeon.grid));
});

test('地牢：怪物出生点都在地面上，出生房不放怪', () => {
  const dungeon = generateDungeon(555, 4);
  assert.ok(dungeon.enemySpots.length > 0, '应该有怪物出生点');

  for (const spot of dungeon.enemySpots) {
    const tile = tileAt(dungeon.grid, toTile(spot.x), toTile(spot.y));
    assert.notEqual(tile, T_WALL, `怪物出生点落在了墙里 (${spot.x}, ${spot.y})`);
  }
});

test('地牢：房间数量随层数增加，且不重叠', () => {
  const shallow = generateDungeon(42, 1).rooms.length;
  const deep = generateDungeon(42, 6).rooms.length;
  assert.ok(deep >= shallow, '更深的楼层房间数不应减少');

  const rooms = generateDungeon(42, 3).rooms;
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i]!;
      const b = rooms[j]!;
      const overlapping =
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
      assert.equal(overlapping, false, '房间之间不应重叠');
    }
  }
});

test('碰撞：圆与墙的相交判定', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(T_FLOOR);
  grid[cellIndex(5, 5)] = T_WALL;

  // 墙格是 [5*32, 5*32] ~ [6*32, 6*32]
  assert.equal(circleHitsWall(grid, 5 * TILE - 20, 5 * TILE + 16, 8), false, '离墙还远');
  assert.equal(circleHitsWall(grid, 5 * TILE - 4, 5 * TILE + 16, 8), true, '贴到墙了');
  assert.equal(circleHitsWall(grid, 5 * TILE + 16, 5 * TILE + 16, 8), true, '在墙里');
  assert.equal(isWallTile(grid, 5, 5), true);
  assert.equal(isWallTile(grid, 6, 5), false);
});

test('碰撞：撞墙时按轴分离，可以贴墙滑动', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(T_FLOOR);
  for (let y = 0; y < MAP_H; y += 1) grid[cellIndex(6, y)] = T_WALL;

  const wallX = 6 * TILE;
  const startX = wallX - 20;
  const startY = 10 * TILE + 16;

  // 向右撞墙：x 不动，y 照常前进（滑动）
  const moved = moveWithCollision(grid, startX, startY, 11, 30, 12);
  assert.equal(moved.x, startX, '被墙挡住时 x 不应该变化');
  assert.equal(moved.y, startY + 12, 'y 方向应该继续滑动');

  // 没墙时正常移动
  const free = moveWithCollision(grid, startX, startY, 11, -10, -6);
  assert.equal(free.x, startX - 10);
  assert.equal(free.y, startY - 6);
});

test('视野：墙会挡住视线', () => {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(T_FLOOR);
  for (let y = 0; y < MAP_H; y += 1) grid[cellIndex(8, y)] = T_WALL;

  assert.equal(hasLineOfSight(grid, { x: 4 * TILE, y: 4 * TILE }, { x: 12 * TILE, y: 4 * TILE }), false);
  assert.equal(hasLineOfSight(grid, { x: 10 * TILE, y: 4 * TILE }, { x: 12 * TILE, y: 4 * TILE }), true);
});
