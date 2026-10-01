/** 楼层构建：从种子生成地牢，并在里面放好玩家、怪物与掉落物。 */
import {
  MAX_ENEMIES,
  MAX_ITEMS,
  PLAYER_MAX_HP,
  TILE,
} from './constants.ts';
import { generateDungeon } from './dungeon.ts';
import { mulberry32, hashSeed } from './rng.ts';
import type { Dungeon, EnemyKind, EnemyState, Item, ItemKind, PlayerState, Vec, World } from './types.ts';
import { emptyInput } from './types.ts';

export type EnemyStats = {
  hp: number;
  speed: number;
  damage: number;
  radius: number;
  /** 接触伤害冷却（秒） */
  touchCd: number;
};

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  slime: { hp: 36, speed: 48, damage: 9, radius: 13, touchCd: 0.9 },
  bat: { hp: 22, speed: 108, damage: 6, radius: 10, touchCd: 0.7 },
  mage: { hp: 30, speed: 64, damage: 11, radius: 11, touchCd: 1.1 },
  boss: { hp: 260, speed: 76, damage: 18, radius: 22, touchCd: 1.2 },
};

export function enemyRadius(kind: EnemyKind): number {
  return ENEMY_STATS[kind].radius;
}

/** 随楼层增长的怪物强度 */
export function scaleForFloor(kind: EnemyKind, floor: number): { hp: number; damage: number } {
  const base = ENEMY_STATS[kind];
  const hpScale = 1 + (floor - 1) * 0.17;
  const dmgScale = 1 + (floor - 1) * 0.09;
  return { hp: Math.round(base.hp * hpScale), damage: Math.round(base.damage * dmgScale) };
}

export function createPlayerState(
  id: string,
  seat: number,
  name: string,
  spawn: Vec,
  offsetIndex: number,
): PlayerState {
  const angle = (offsetIndex / 4) * Math.PI * 2;
  return {
    id,
    seat: seat as PlayerState['seat'],
    name,
    x: spawn.x + Math.cos(angle) * TILE * 0.9,
    y: spawn.y + Math.sin(angle) * TILE * 0.9,
    vx: 0,
    vy: 0,
    hp: PLAYER_MAX_HP,
    maxHp: PLAYER_MAX_HP,
    aimX: 1,
    aimY: 0,
    attackCd: 0,
    attackAnim: 0,
    dashCd: 0,
    dashTime: 0,
    down: 0,
    hurting: 0,
    kills: 0,
    coins: 0,
    onStairs: false,
    input: emptyInput(),
  };
}

export function pickEnemyKind(rand: () => number, floor: number): EnemyKind {
  const roll = rand();
  if (floor >= 3 && roll < 0.22) return 'mage';
  if (floor >= 2 && roll < 0.5) return 'bat';
  return 'slime';
}

export function createEnemy(id: number, kind: EnemyKind, x: number, y: number, floor: number): EnemyState {
  const { hp } = scaleForFloor(kind, floor);
  return {
    id,
    kind,
    x,
    y,
    vx: 0,
    vy: 0,
    hp,
    maxHp: hp,
    cd: kind === 'boss' ? 2.5 : 0.6 + Math.random() * 0.8,
    touch: 0,
    hurting: 0,
    awake: false,
    phase: 0,
  };
}

/** 往世界里加一只怪（模拟与测试都用它）。 */
export function spawnEnemy(
  world: World,
  kind: EnemyKind,
  x: number,
  y: number,
  awake = false,
): EnemyState {
  const enemy = createEnemy(world.nextId, kind, x, y, world.floor);
  world.nextId += 1;
  enemy.awake = awake;
  world.enemies.push(enemy);
  world.enemiesLeft = world.enemies.length;
  return enemy;
}

function createItem(id: number, x: number, y: number, kind: ItemKind): Item {
  return { id, x, y, kind, bob: Math.random() * Math.PI * 2 };
}

function placeEntities(world: World, dungeon: Dungeon): void {
  const rand = mulberry32(hashSeed(world.seed, world.floor * 977 + 13));
  let id = world.nextId;
  const isBossFloor = world.floor % 3 === 0;

  world.enemies = [];
  const spots = dungeon.enemySpots.slice(0, MAX_ENEMIES);
  spots.forEach((spot, index) => {
    const isBoss = isBossFloor && index === spots.length - 1;
    const kind = isBoss ? 'boss' : pickEnemyKind(rand, world.floor);
    world.enemies.push(createEnemy(id, kind, spot.x, spot.y, world.floor));
    id += 1;
  });

  world.items = dungeon.itemSpots.slice(0, MAX_ITEMS).map((spot) => {
    const roll = rand();
    const kind: ItemKind = roll < 0.55 ? 'coin' : roll < 0.9 ? 'heart' : 'potion';
    const item = createItem(id, spot.x, spot.y, kind);
    id += 1;
    return item;
  });

  world.nextId = id;
  world.enemiesLeft = world.enemies.length;
  world.projectiles = [];
  world.stairsHold = 0;
}

export function createWorld(
  seed: number,
  players: Array<{ id: string; seat: number; name: string }>,
): World {
  const world: World = {
    seed,
    floor: 1,
    tick: 0,
    time: 0,
    phase: 'playing',
    dungeon: generateDungeon(seed, 1),
    players: [],
    enemies: [],
    projectiles: [],
    items: [],
    events: [],
    nextId: 1,
    score: 0,
    enemiesLeft: 0,
    stairsHold: 0,
  };

  world.players = players.map((player, index) =>
    createPlayerState(player.id, player.seat, player.name, world.dungeon.start, index),
  );

  placeEntities(world, world.dungeon);
  world.events.push({ type: 'floor-enter', floor: 1 });
  return world;
}

/** 进入下一层：重新生成地牢，玩家回到出生点并回满血。 */
export function nextFloor(world: World): void {
  world.floor += 1;
  world.dungeon = generateDungeon(world.seed, world.floor);
  world.phase = 'playing';
  world.time = 0;
  world.events.length = 0;

  world.players.forEach((player, index) => {
    const spawn = createPlayerState(player.id, player.seat, player.name, world.dungeon.start, index);
    player.x = spawn.x;
    player.y = spawn.y;
    player.vx = 0;
    player.vy = 0;
    player.hp = player.maxHp;
    player.down = 0;
    player.onStairs = false;
    player.attackCd = 0;
    player.dashCd = 0;
    player.dashTime = 0;
    player.attackAnim = 0;
  });

  placeEntities(world, world.dungeon);
  world.events.push({ type: 'floor-enter', floor: world.floor });
  world.stairsHold = 0;
}

/** 玩家复活到本层出生点。 */
export function revivePlayer(world: World, player: PlayerState, index: number): void {
  const spawn = createPlayerState(player.id, player.seat, player.name, world.dungeon.start, index);
  player.x = spawn.x;
  player.y = spawn.y;
  player.vx = 0;
  player.vy = 0;
  player.hp = Math.round(player.maxHp * 0.6);
  player.down = 0;
  player.hurting = 0;
  player.onStairs = false;
}
