/**
 * 机器人跑图测试：用一个「朝最近的怪走、贴脸就砍」的简单策略把整局跑起来。
 *
 * 目的不是测某个函数，而是把 移动 / 碰撞 / 战斗 / AI / 掉落 / 清层 / 下楼
 * 全部串起来跑几分钟游戏时间，确保流程能走通、数值会累加、不会卡死或崩掉。
 *
 * 注意：为了让这个「没有寻路能力」的机器人不去撞墙，这里把地图铲平成开阔场地；
 * 真实地牢里的走位由浏览器端到端测试覆盖。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SIM_DT, STAIRS_HOLD, T_FLOOR } from '../src/game/constants.ts';
import { stepWorld } from '../src/game/sim.ts';
import { createWorld } from '../src/game/world.ts';
import type { World } from '../src/game/types.ts';

/** 一个很笨但够用的策略：走向最近的怪，靠近就砍；没怪了就去楼梯 */
function driveBot(world: World): void {
  const player = world.players[0]!;
  const input = player.input;
  input.up = false;
  input.down = false;
  input.left = false;
  input.right = false;
  input.attack = false;
  input.dash = false;

  let targetX = world.dungeon.stairs.x;
  let targetY = world.dungeon.stairs.y;
  let best = Infinity;

  for (const enemy of world.enemies) {
    const distance = (enemy.x - player.x) ** 2 + (enemy.y - player.y) ** 2;
    if (distance < best) {
      best = distance;
      targetX = enemy.x;
      targetY = enemy.y;
    }
  }

  const dx = targetX - player.x;
  const dy = targetY - player.y;
  const distance = Math.hypot(dx, dy) || 1;

  input.right = dx > 8;
  input.left = dx < -8;
  input.down = dy > 8;
  input.up = dy < -8;
  input.aimX = dx / distance;
  input.aimY = dy / distance;
  if (best < 44 * 44) input.attack = true;
}

test('机器人：能打怪、能清层、能走到下一层（跑 5 分钟游戏时间）', () => {
  const world = createWorld(20261001, [{ id: 'bot', seat: 0, name: '机器人' }]);
  world.dungeon.grid.fill(T_FLOOR); // 铲平成开阔场地

  const player = world.players[0]!;
  player.maxHp = 100000; // 专注验证流程，别被怪打死
  player.hp = 100000;

  const maxSteps = Math.round(300 / SIM_DT);
  let cleared = 0;
  let lastFloor = world.floor;

  for (let step = 0; step < maxSteps && world.floor < 3; step += 1) {
    driveBot(world);
    stepWorld(world, SIM_DT);

    if (world.floor !== lastFloor) {
      assert.ok(world.floor > lastFloor, '楼层只应该往上加');
      lastFloor = world.floor;
    }
    if (world.phase === 'cleared') cleared += 1;
  }

  assert.ok(player.kills > 0, `机器人应该有击杀记录（实际 ${player.kills}）`);
  assert.ok(world.score >= player.kills * 12, '分数至少要覆盖击杀奖励');
  assert.ok(cleared > 0, '应该至少清空过一层');
  assert.ok(
    world.floor >= 2,
    `机器人应该下到第 2 层（实际停在第 ${world.floor} 层，击杀 ${player.kills}，剩余怪 ${world.enemies.length}）`,
  );
});

test('机器人：拿到的金币会累加到个人统计上', () => {
  const world = createWorld(4321, [{ id: 'bot', seat: 0, name: '机器人' }]);
  world.dungeon.grid.fill(T_FLOOR);
  const player = world.players[0]!;
  player.maxHp = 100000;
  player.hp = 100000;
  world.items = [{ id: 1, x: player.x, y: player.y, kind: 'coin', bob: 0 }];

  driveBot(world);
  stepWorld(world, SIM_DT);

  assert.equal(player.coins, 1, '走过金币应该 +1');
});

test('清层后站在楼梯上会进入下一层，并且回满血', () => {
  const world = createWorld(777, [{ id: 'bot', seat: 0, name: '机器人' }]);
  world.enemies = [];
  world.enemiesLeft = 0;

  const player = world.players[0]!;
  player.x = world.dungeon.stairs.x;
  player.y = world.dungeon.stairs.y;
  player.hp = 20;

  const steps = Math.round((STAIRS_HOLD + 0.3) / SIM_DT);
  for (let i = 0; i < steps; i += 1) stepWorld(world, SIM_DT);

  assert.equal(world.floor, 2);
  assert.equal(world.players[0]!.hp, world.players[0]!.maxHp, '下层应该回满血');
  assert.ok(world.enemies.length > 0, '新一层应该有怪物');
});
