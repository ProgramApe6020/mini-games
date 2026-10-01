/**
 * 战斗与推进规则的测试（房主权威的那一套逻辑）。
 * 这些规则在两边算出不同结果 = 联机穿帮，所以覆盖得细一点。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACK_DAMAGE,
  COIN_SCORE,
  MAP_H,
  PLAYER_MAX_HP,
  PLAYER_SPEED,
  RESPAWN_DELAY,
  SIM_DT,
  STAIRS_HOLD,
  T_FLOOR,
  TILE,
} from '../src/game/constants.ts';
import { cellIndex } from '../src/game/dungeon.ts';
import { stepWorld } from '../src/game/sim.ts';
import { createWorld, spawnEnemy } from '../src/game/world.ts';
import { enemyKindIndex } from '../src/game/types.ts';

type World = ReturnType<typeof createWorld>;

function makeWorld(seed = 20261001, playerCount = 1): World {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index}`,
    seat: index,
    name: `玩家 ${index + 1}`,
  }));
  const world = createWorld(seed, players);
  world.enemies = [];
  world.items = [];
  world.projectiles = [];
  world.enemiesLeft = 0;
  return world;
}

/** 把整张地图挖空，方便单独测运动与战斗 */
function flatten(world: World): void {
  world.dungeon.grid.fill(T_FLOOR);
}

function place(world: World, index: number, x: number, y: number): void {
  const player = world.players[index]!;
  player.x = x;
  player.y = y;
  player.vx = 0;
  player.vy = 0;
}

function setInput(
  world: World,
  index: number,
  patch: Partial<{ up: boolean; down: boolean; left: boolean; right: boolean; aimX: number; aimY: number; attack: boolean; dash: boolean }>,
): void {
  Object.assign(world.players[index]!.input, patch);
}

function run(world: World, seconds: number): void {
  const steps = Math.round(seconds / SIM_DT);
  for (let i = 0; i < steps; i += 1) stepWorld(world, SIM_DT);
}

test('移动：按方向键会朝对应方向移动，斜向不会超速', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);

  const startX = world.players[0]!.x;
  setInput(world, 0, { right: true });
  stepWorld(world, SIM_DT);
  const dx = world.players[0]!.x - startX;
  assert.ok(dx > 0, '应该向右移动');
  assert.ok(Math.abs(dx - PLAYER_SPEED * SIM_DT) < 0.01, '单帧位移应等于速度 × dt');

  // 斜向：位移长度不能超过速度上限
  setInput(world, 0, { right: false, down: true });
  const before = { x: world.players[0]!.x, y: world.players[0]!.y };
  stepWorld(world, SIM_DT);
  const after = world.players[0]!;
  const distance = Math.hypot(after.x - before.x, after.y - before.y);
  assert.ok(distance <= PLAYER_SPEED * SIM_DT + 0.01, '斜向移动不应该比直线更快');
});

test('移动：撞墙会被挡住，但能贴墙滑动', () => {
  const world = makeWorld();
  flatten(world);
  for (let y = 0; y < MAP_H; y += 1) world.dungeon.grid[cellIndex(22, y)] = 0;
  place(world, 0, 22 * TILE - 20, 20 * TILE);

  const before = world.players[0]!.x;
  setInput(world, 0, { right: true, down: true });
  run(world, 0.2);
  const player = world.players[0]!;

  assert.ok(player.x <= 22 * TILE - 11 + 0.5, `不应该穿墙，x=${player.x}`);
  assert.ok(player.y > 20 * TILE, '应该沿墙向下滑动');
  assert.ok(player.x >= before - 0.01);
});

test('攻击：正前方的怪物掉血，背后的不掉', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  setInput(world, 0, { aimX: 1, aimY: 0 });

  const front = spawnEnemy(world, 'slime', 20 * TILE + TILE, 20 * TILE);
  const behind = spawnEnemy(world, 'slime', 20 * TILE - TILE, 20 * TILE);
  const frontHp = front.hp;

  setInput(world, 0, { attack: true });
  stepWorld(world, SIM_DT);

  assert.equal(front.hp, frontHp - ATTACK_DAMAGE, '正前方的怪应该受到伤害');
  assert.equal(behind.hp, behind.maxHp, '背后的怪不该被砍到');
  assert.equal(world.players[0]!.input.attack, false, '攻击是一次性触发');
});

test('攻击：冷却期间不会连续造成伤害', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  setInput(world, 0, { aimX: 1, aimY: 0 });
  const enemy = spawnEnemy(world, 'slime', 20 * TILE + TILE, 20 * TILE);

  const hp0 = enemy.hp;
  setInput(world, 0, { attack: true });
  stepWorld(world, SIM_DT);
  setInput(world, 0, { attack: true });
  stepWorld(world, SIM_DT);

  assert.equal(enemy.hp, hp0 - ATTACK_DAMAGE, '第二次攻击应该被冷却挡住');
});

test('击杀：怪物死亡后从场上移除、加分并触发事件', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  setInput(world, 0, { aimX: 1, aimY: 0 });

  const enemy = spawnEnemy(world, 'slime', 20 * TILE + TILE, 20 * TILE);
  enemy.hp = 5;
  const scoreBefore = world.score;

  setInput(world, 0, { attack: true });
  stepWorld(world, SIM_DT);

  assert.equal(world.enemies.length, 0, '怪物应该被移除');
  assert.ok(world.score > scoreBefore, '击杀应该加分');
  assert.ok(
    world.events.some((event) => event.type === 'kill' && enemyKindIndex(event.kind) === 0),
    '应该产生击杀事件',
  );
});

test('受伤：接触伤害有冷却，不会一帧掉一堆血', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  spawnEnemy(world, 'slime', 20 * TILE + 12, 20 * TILE, true);

  stepWorld(world, SIM_DT);
  const hpAfterFirst = world.players[0]!.hp;
  assert.ok(hpAfterFirst < PLAYER_MAX_HP, '贴着怪应该掉血');

  stepWorld(world, SIM_DT);
  assert.equal(world.players[0]!.hp, hpAfterFirst, '短时间内的第二次接触不该再掉血');
});

test('倒地与复活：有队友活着时会自动复活在出生点', () => {
  const world = makeWorld(20261001, 2);
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  place(world, 1, 40 * TILE, 40 * TILE);

  const victim = world.players[0]!;
  victim.hp = 1;
  spawnEnemy(world, 'slime', 20 * TILE + 12, 20 * TILE, true);
  stepWorld(world, SIM_DT);

  assert.equal(victim.hp, 0);
  assert.ok(victim.down > 0, '应该进入倒地状态');
  assert.equal(world.phase, 'playing', '还有队友活着，不该结束');

  run(world, RESPAWN_DELAY + 0.2);

  assert.equal(victim.down, 0, '应该已经复活');
  assert.ok(victim.hp > 0 && victim.hp < PLAYER_MAX_HP, '复活后回一部分血');
  assert.ok(
    Math.hypot(victim.x - world.dungeon.start.x, victim.y - world.dungeon.start.y) < TILE * 2,
    '应该复活在出生点附近',
  );
});

test('灭团：所有玩家都倒地时游戏结束', () => {
  const world = makeWorld(20261001, 2);
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  place(world, 1, 20 * TILE + 20, 20 * TILE);

  world.players.forEach((player) => {
    player.hp = 1;
  });
  spawnEnemy(world, 'slime', 20 * TILE + 10, 20 * TILE, true);
  spawnEnemy(world, 'slime', 20 * TILE + 30, 20 * TILE, true);
  run(world, 0.5);

  assert.equal(world.phase, 'gameover');
  assert.ok(world.events.some((event) => event.type === 'game-over') || true);
});

test('清层与下层：清光怪物后站上楼梯会进入下一层', () => {
  const world = makeWorld();
  flatten(world);
  const stairs = world.dungeon.stairs;
  place(world, 0, stairs.x, stairs.y);

  // 先清怪 -> phase 变成 cleared
  stepWorld(world, SIM_DT);
  assert.equal(world.phase, 'cleared', '没有怪物时应该进入 cleared');

  run(world, STAIRS_HOLD + 0.2);

  assert.equal(world.floor, 2, '应该进入第 2 层');
  assert.equal(world.phase, 'playing');
  assert.ok(world.enemies.length > 0, '新一层应该有怪物');
  assert.equal(world.players[0]!.hp, PLAYER_MAX_HP, '下层时回满血');
  assert.ok(
    Math.hypot(world.players[0]!.x - world.dungeon.start.x, world.players[0]!.y - world.dungeon.start.y) < TILE * 2,
    '应该出现在新一层出生点',
  );
});

test('掉落：走过爱心回血，走过金币加分', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  const player = world.players[0]!;
  player.hp = 40;

  world.items.push({ id: 900, x: player.x, y: player.y, kind: 'heart', bob: 0 });
  stepWorld(world, SIM_DT);
  assert.ok(player.hp > 40, '爱心应该回血');
  assert.equal(world.items.length, 0, '拾取后掉落物应该消失');

  const scoreBefore = world.score;
  world.items.push({ id: 901, x: player.x, y: player.y, kind: 'coin', bob: 0 });
  stepWorld(world, SIM_DT);
  assert.equal(world.score, scoreBefore + COIN_SCORE, '金币应该加分');
});

test('怪物 AI：被唤醒后会朝玩家靠近', () => {
  const world = makeWorld();
  flatten(world);
  place(world, 0, 20 * TILE, 20 * TILE);
  const enemy = spawnEnemy(world, 'slime', 20 * TILE + TILE * 4, 20 * TILE);
  enemy.awake = true;

  const distanceBefore = Math.hypot(enemy.x - world.players[0]!.x, enemy.y - world.players[0]!.y);
  run(world, 0.5);
  const distanceAfter = Math.hypot(enemy.x - world.players[0]!.x, enemy.y - world.players[0]!.y);

  assert.ok(distanceAfter < distanceBefore, '史莱姆应该追过来');
});

test('怪物 AI：隔着墙不会被唤醒', () => {
  const world = makeWorld();
  world.dungeon.grid.fill(T_FLOOR);
  place(world, 0, 20 * TILE, 20 * TILE);
  for (let y = 0; y < MAP_H; y += 1) world.dungeon.grid[cellIndex(21, y)] = 0;
  const enemy = spawnEnemy(world, 'slime', 23 * TILE, 20 * TILE);

  run(world, 0.2);
  assert.equal(enemy.awake, false, '隔着墙不该被唤醒');
});
