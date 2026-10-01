/**
 * 快照打包 / 解包。
 *
 * 房主每 1/20 秒广播一次完整世界状态。为了控制体积：
 *   - 地图不传（客户端用 seed + floor 自己生成）；
 *   - 坐标取整、朝向保留两位小数；
 *   - 用短键名和数组而不是对象；
 *   - 怪物的 maxHp 由 kind + floor 推导，不传。
 */
import { PLAYER_MAX_HP } from './constants.ts';
import type { EnemyKind, World, WorldEvent } from './types.ts';
import { enemyKindFromIndex, enemyKindIndex } from './types.ts';
import { scaleForFloor } from './world.ts';

export const SNAPSHOT_VERSION = 1;

export type PackedSnapshot = {
  v: number;
  /** tick */
  t: number;
  /** floor */
  f: number;
  /** seed */
  sd: number;
  /** phase: 0 playing / 1 cleared / 2 gameover */
  ph: number;
  /** score */
  sc: number;
  /** stairsHold */
  sh: number;
  /** players */
  p: number[][];
  /** enemies */
  e: number[][];
  /** projectiles */
  b: number[][];
  /** items */
  i: number[][];
  /** events */
  ev: number[][];
};

export type SnapshotPlayer = {
  seat: number;
  x: number;
  y: number;
  hp: number;
  aimX: number;
  aimY: number;
  attackAnim: number;
  down: number;
  hurting: number;
  kills: number;
  coins: number;
};

export type SnapshotEnemy = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hurting: number;
  awake: boolean;
};

export type SnapshotProjectile = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  from: 'enemy' | 'player';
};

export type SnapshotItem = { id: number; x: number; y: number; kind: 'heart' | 'coin' | 'potion' };

export type Snapshot = {
  tick: number;
  floor: number;
  seed: number;
  phase: number;
  score: number;
  stairsHold: number;
  players: SnapshotPlayer[];
  enemies: SnapshotEnemy[];
  projectiles: SnapshotProjectile[];
  items: SnapshotItem[];
  events: WorldEvent[];
};

const EVENT_INDEX: Record<WorldEvent['type'], number> = {
  hit: 0,
  kill: 1,
  'player-down': 2,
  'player-revive': 3,
  'floor-cleared': 4,
  'floor-enter': 5,
  pickup: 6,
  'game-over': 7,
};

const ITEM_KINDS: SnapshotItem['kind'][] = ['heart', 'coin', 'potion'];

const round = (value: number): number => Math.round(value);
const round2 = (value: number): number => Math.round(value * 100) / 100;

export function phaseToNumber(phase: World['phase']): number {
  return phase === 'playing' ? 0 : phase === 'cleared' ? 1 : 2;
}

export function phaseFromNumber(value: number): World['phase'] {
  return value === 0 ? 'playing' : value === 1 ? 'cleared' : 'gameover';
}

export function packSnapshot(world: World): PackedSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    t: world.tick,
    f: world.floor,
    sd: world.seed,
    ph: phaseToNumber(world.phase),
    sc: world.score,
    sh: round2(world.stairsHold),
    p: world.players.map((player) => [
      player.seat,
      round(player.x),
      round(player.y),
      Math.round(player.hp),
      round2(player.aimX),
      round2(player.aimY),
      round2(player.attackAnim),
      round2(player.down),
      round2(player.hurting),
      player.kills,
      player.coins,
    ]),
    e: world.enemies.map((enemy) => [
      enemy.id,
      enemyKindIndex(enemy.kind),
      round(enemy.x),
      round(enemy.y),
      Math.round(enemy.hp),
      round2(enemy.hurting),
      enemy.awake ? 1 : 0,
    ]),
    b: world.projectiles.map((projectile) => [
      projectile.id,
      round(projectile.x),
      round(projectile.y),
      Math.round(projectile.vx),
      Math.round(projectile.vy),
      projectile.from === 'enemy' ? 0 : 1,
    ]),
    i: world.items.map((item) => [item.id, round(item.x), round(item.y), ITEM_KINDS.indexOf(item.kind)]),
    ev: world.events.map((event) => {
      const type = EVENT_INDEX[event.type];
      if (event.type === 'hit') return [type, round(event.x), round(event.y), Math.round(event.amount)];
      if (event.type === 'kill') return [type, round(event.x), round(event.y), enemyKindIndex(event.kind)];
      if (event.type === 'pickup') return [type, round(event.x), round(event.y), ITEM_KINDS.indexOf(event.kind)];
      if (event.type === 'player-down' || event.type === 'player-revive') return [type, event.seat, 0, 0];
      if (event.type === 'floor-cleared' || event.type === 'floor-enter') return [type, event.floor, 0, 0];
      return [type, 0, 0, 0];
    }),
  };
}

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function numArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const out: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isFinite(entry)) return null;
    out.push(entry);
  }
  return out;
}

/** 校验并解包网络来的快照（不可信输入，结构不对就丢弃）。 */
export function unpackSnapshot(input: unknown): Snapshot | null {
  if (typeof input !== 'object' || input === null) return null;
  const packed = input as Partial<PackedSnapshot>;
  if (packed.v !== SNAPSHOT_VERSION) return null;

  const floor = num(packed.f, 1);
  const seed = num(packed.sd, 0);
  if (!Number.isFinite(floor) || floor < 1) return null;

  const players: SnapshotPlayer[] = [];
  for (const entry of packed.p ?? []) {
    const row = numArray(entry);
    if (!row || row.length < 11) continue;
    players.push({
      seat: row[0]!,
      x: row[1]!,
      y: row[2]!,
      hp: row[3]!,
      aimX: row[4]!,
      aimY: row[5]!,
      attackAnim: row[6]!,
      down: row[7]!,
      hurting: row[8]!,
      kills: row[9]!,
      coins: row[10]!,
    });
  }

  const enemies: SnapshotEnemy[] = [];
  for (const entry of packed.e ?? []) {
    const row = numArray(entry);
    if (!row || row.length < 7) continue;
    const kind = enemyKindFromIndex(row[1]!);
    const { hp: maxHp } = scaleForFloor(kind, floor);
    enemies.push({
      id: row[0]!,
      kind,
      x: row[2]!,
      y: row[3]!,
      hp: row[4]!,
      maxHp,
      hurting: row[5]!,
      awake: row[6]! > 0.5,
    });
  }

  const projectiles: SnapshotProjectile[] = [];
  for (const entry of packed.b ?? []) {
    const row = numArray(entry);
    if (!row || row.length < 6) continue;
    projectiles.push({
      id: row[0]!,
      x: row[1]!,
      y: row[2]!,
      vx: row[3]!,
      vy: row[4]!,
      from: row[5]! === 0 ? 'enemy' : 'player',
    });
  }

  const items: SnapshotItem[] = [];
  for (const entry of packed.i ?? []) {
    const row = numArray(entry);
    if (!row || row.length < 4) continue;
    const kind = ITEM_KINDS[row[3]!] ?? 'coin';
    items.push({ id: row[0]!, x: row[1]!, y: row[2]!, kind });
  }

  const events: WorldEvent[] = [];
  for (const entry of packed.ev ?? []) {
    const row = numArray(entry);
    if (!row || row.length < 4) continue;
    const type = row[0]!;
    if (type === 0) events.push({ type: 'hit', x: row[1]!, y: row[2]!, amount: row[3]! });
    else if (type === 1) events.push({ type: 'kill', x: row[1]!, y: row[2]!, kind: enemyKindFromIndex(row[3]!) });
    else if (type === 2) events.push({ type: 'player-down', seat: row[1]! as 0 });
    else if (type === 3) events.push({ type: 'player-revive', seat: row[1]! as 0 });
    else if (type === 4) events.push({ type: 'floor-cleared', floor: row[1]! });
    else if (type === 5) events.push({ type: 'floor-enter', floor: row[1]! });
    else if (type === 6) events.push({ type: 'pickup', x: row[1]!, y: row[2]!, kind: ITEM_KINDS[row[3]!] ?? 'coin' });
    else if (type === 7) events.push({ type: 'game-over' });
  }

  return {
    tick: num(packed.t, 0),
    floor,
    seed,
    phase: num(packed.ph, 0),
    score: num(packed.sc, 0),
    stairsHold: num(packed.sh, 0),
    players,
    enemies,
    projectiles,
    items,
    events,
  };
}

/** 血量百分比（给 UI 用）。 */
export function hpRatio(hp: number, maxHp = PLAYER_MAX_HP): number {
  return Math.max(0, Math.min(1, hp / maxHp));
}
