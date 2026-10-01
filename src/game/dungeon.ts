/**
 * 程序化地牢生成 —— 联机的关键：房主只把 {seed, floor} 发出去，
 * 所有客户端用同样的种子各生成一份完全相同的地图（不传地图数据，省带宽）。
 */
import { MAP_H, MAP_W, T_FLOOR, T_STAIRS, T_WALL, TILE } from './constants.ts';
import { hashSeed, mulberry32, randInt } from './rng.ts';
import type { Dungeon, Room, Vec } from './types.ts';

const ROOM_W_MIN = 6;
const ROOM_W_MAX = 11;
const ROOM_H_MIN = 5;
const ROOM_H_MAX = 9;
const MARGIN = 2;
const MAX_TRIES = 240;

export function cellIndex(tx: number, ty: number): number {
  return ty * MAP_W + tx;
}

export function tileAt(grid: Uint8Array, tx: number, ty: number): number {
  if (tx < 0 || ty < 0 || tx >= MAP_W || ty >= MAP_H) return T_WALL;
  return grid[cellIndex(tx, ty)] ?? T_WALL;
}

export function isWallTile(grid: Uint8Array, tx: number, ty: number): boolean {
  return tileAt(grid, tx, ty) === T_WALL;
}

/** 瓦片中心的世界坐标 */
export function tileCenter(tile: number): number {
  return tile * TILE + TILE / 2;
}

export function toTile(world: number): number {
  return Math.floor(world / TILE);
}

function overlaps(a: Room, b: Room, pad: number): boolean {
  return (
    a.x - pad < b.x + b.w &&
    a.x + a.w + pad > b.x &&
    a.y - pad < b.y + b.h &&
    a.y + a.h + pad > b.y
  );
}

function roomCenter(room: Room): Vec {
  return {
    x: tileCenter(room.x + Math.floor(room.w / 2)),
    y: tileCenter(room.y + Math.floor(room.h / 2)),
  };
}

/** 在两点之间挖一条 2 格宽的 L 形通道 */
function carveCorridor(grid: Uint8Array, from: Vec, to: Vec, rand: () => number): void {
  const horizontalFirst = rand() < 0.5;

  const carve = (tx: number, ty: number) => {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) {
        const x = tx + dx;
        const y = ty + dy;
        if (x > 0 && y > 0 && x < MAP_W - 1 && y < MAP_H - 1) grid[cellIndex(x, y)] = T_FLOOR;
      }
    }
  };

  // 关键：房间中心给的是世界坐标（像素），必须先换算成瓦片下标
  let x = toTile(from.x);
  let y = toTile(from.y);
  const targetX = toTile(to.x);
  const targetY = toTile(to.y);
  const stepX = Math.sign(targetX - x);
  const stepY = Math.sign(targetY - y);

  if (horizontalFirst) {
    while (x !== targetX) {
      carve(x, y);
      x += stepX;
    }
    while (y !== targetY) {
      carve(x, y);
      y += stepY;
    }
  } else {
    while (y !== targetY) {
      carve(x, y);
      y += stepY;
    }
    while (x !== targetX) {
      carve(x, y);
      x += stepX;
    }
  }
  carve(targetX, targetY);
}

/** 随机挑一个房间内部的方形区域里的瓦片坐标 */
function randomTileInRoom(rand: () => number, room: Room, pad = 1): { tx: number; ty: number } {
  const tx = randInt(rand, room.x + pad, Math.max(room.x + pad, room.x + room.w - 1 - pad));
  const ty = randInt(rand, room.y + pad, Math.max(room.y + pad, room.y + room.h - 1 - pad));
  return { tx, ty };
}

export function generateDungeon(seed: number, floor: number): Dungeon {
  const rand = mulberry32(hashSeed(seed, floor));
  const grid = new Uint8Array(MAP_W * MAP_H); // 默认全是墙
  const rooms: Room[] = [];
  const targetRooms = 6 + Math.min(floor, 5);

  for (let tries = 0; tries < MAX_TRIES && rooms.length < targetRooms; tries += 1) {
    const w = randInt(rand, ROOM_W_MIN, ROOM_W_MAX);
    const h = randInt(rand, ROOM_H_MIN, ROOM_H_MAX);
    const x = randInt(rand, MARGIN, MAP_W - MARGIN - w);
    const y = randInt(rand, MARGIN, MAP_H - MARGIN - h);
    const room: Room = { x, y, w, h };
    if (rooms.some((other) => overlaps(other, room, 2))) continue;
    rooms.push(room);
  }

  for (const room of rooms) {
    for (let y = room.y; y < room.y + room.h; y += 1) {
      for (let x = room.x; x < room.x + room.w; x += 1) {
        grid[cellIndex(x, y)] = T_FLOOR;
      }
    }
  }

  // 主线：按横坐标排序后依次连通，保证所有房间可达
  const ordered = [...rooms].sort((a, b) => a.x + a.y * 0.5 - (b.x + b.y * 0.5));
  for (let i = 1; i < ordered.length; i += 1) {
    carveCorridor(grid, roomCenter(ordered[i - 1]!), roomCenter(ordered[i]!), rand);
  }

  // 额外通道：制造环路，避免一条道走到黑
  const extra = 2 + Math.min(floor, 3);
  for (let i = 0; i < extra && ordered.length > 3; i += 1) {
    const a = ordered[randInt(rand, 0, ordered.length - 1)]!;
    const b = ordered[randInt(rand, 0, ordered.length - 1)]!;
    if (a === b) continue;
    carveCorridor(grid, roomCenter(a), roomCenter(b), rand);
  }

  // 出生房选最靠左上的，楼梯房选离出生最远的
  const byTopLeft = [...ordered].sort((a, b) => a.x + a.y - (b.x + b.y));
  const startRoom = byTopLeft[0]!;
  const start = roomCenter(startRoom);

  let stairsRoom = ordered[0]!;
  let bestDistance = -1;
  for (const room of ordered) {
    if (room === startRoom) continue;
    const center = roomCenter(room);
    const distance = (center.x - start.x) ** 2 + (center.y - start.y) ** 2;
    if (distance > bestDistance) {
      bestDistance = distance;
      stairsRoom = room;
    }
  }
  const stairs = roomCenter(stairsRoom);

  // 楼梯瓦片
  const stairsTile = { tx: toTile(stairs.x), ty: toTile(stairs.y) };
  grid[cellIndex(stairsTile.tx, stairsTile.ty)] = T_STAIRS;

  // 怪物与掉落点：出生房不放怪
  const isBossFloor = floor % 3 === 0;
  const enemySpots: Vec[] = [];
  const itemSpots: Vec[] = [];
  const perRoom = Math.min(2 + Math.floor(floor / 2), 5);

  for (const room of rooms) {
    if (room === startRoom) {
      // 出生房给一点补给
      const { tx, ty } = randomTileInRoom(rand, room);
      itemSpots.push({ x: tileCenter(tx), y: tileCenter(ty) });
      continue;
    }

    const count = room === stairsRoom && isBossFloor ? 0 : perRoom;
    for (let i = 0; i < count; i += 1) {
      const { tx, ty } = randomTileInRoom(rand, room);
      const jitterX = (rand() - 0.5) * TILE * 0.5;
      const jitterY = (rand() - 0.5) * TILE * 0.5;
      enemySpots.push({ x: tileCenter(tx) + jitterX, y: tileCenter(ty) + jitterY });
    }

    const items = randInt(rand, 1, 2);
    for (let i = 0; i < items; i += 1) {
      const { tx, ty } = randomTileInRoom(rand, room);
      itemSpots.push({ x: tileCenter(tx), y: tileCenter(ty) });
    }
  }

  // Boss 层：把 boss 放在楼梯房中心
  if (isBossFloor) {
    enemySpots.push({ x: stairs.x, y: stairs.y });
  }

  return { seed, floor, grid, rooms, start, stairs, enemySpots, itemSpots };
}

// ---------------------------------------------------------------- 碰撞

/** 圆形是否与墙相交 */
export function circleHitsWall(grid: Uint8Array, x: number, y: number, r: number): boolean {
  const minTx = toTile(x - r);
  const maxTx = toTile(x + r);
  const minTy = toTile(y - r);
  const maxTy = toTile(y + r);

  for (let ty = minTy; ty <= maxTy; ty += 1) {
    for (let tx = minTx; tx <= maxTx; tx += 1) {
      if (!isWallTile(grid, tx, ty)) continue;
      // 圆 vs 矩形
      const rectX = tx * TILE;
      const rectY = ty * TILE;
      const closestX = Math.max(rectX, Math.min(x, rectX + TILE));
      const closestY = Math.max(rectY, Math.min(y, rectY + TILE));
      const dx = x - closestX;
      const dy = y - closestY;
      if (dx * dx + dy * dy < r * r) return true;
    }
  }
  return false;
}

/**
 * 按轴分别推进再检测，实现「贴着墙滑动」的手感。
 * 返回最终坐标。
 */
export function moveWithCollision(
  grid: Uint8Array,
  x: number,
  y: number,
  r: number,
  dx: number,
  dy: number,
): Vec {
  let nx = x + dx;
  let ny = y + dy;

  if (circleHitsWall(grid, nx, y, r)) nx = x;
  if (circleHitsWall(grid, nx, ny, r)) ny = y;

  return { x: nx, y: ny };
}

/** 两点之间是否被墙挡住（给怪物视野用，粗粒度采样） */
export function hasLineOfSight(grid: Uint8Array, from: Vec, to: Vec, step = TILE * 0.6): boolean {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(distance / step));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    if (isWallTile(grid, toTile(from.x + dx * t), toTile(from.y + dy * t))) return false;
  }
  return true;
}
