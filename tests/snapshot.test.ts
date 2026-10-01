/**
 * 网络快照的打包 / 解包测试。
 * 快照是房主每秒发 20 次的唯一数据，既要小、又要能被不可信输入安全解析。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { TILE } from '../src/game/constants.ts';
import { packSnapshot, unpackSnapshot, SNAPSHOT_VERSION } from '../src/game/snapshot.ts';
import { stepWorld } from '../src/game/sim.ts';
import { createWorld, spawnEnemy } from '../src/game/world.ts';

function makeWorld(playerCount = 4) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index}`,
    seat: index,
    name: `玩家 ${index + 1}`,
  }));
  return createWorld(20261001, players);
}

test('快照：打包后能原样解回来', () => {
  const world = makeWorld(4);
  world.players[0]!.x = 12 * TILE + 3;
  world.players[0]!.y = 9 * TILE + 7;
  world.players[1]!.hp = 42;
  world.score = 1234;

  const packed = packSnapshot(world);
  const snapshot = unpackSnapshot(packed);

  assert.ok(snapshot, '应该解析成功');
  assert.equal(snapshot.floor, world.floor);
  assert.equal(snapshot.seed, world.seed);
  assert.equal(snapshot.tick, world.tick);
  assert.equal(snapshot.score, 1234);
  assert.equal(snapshot.players.length, 4);
  assert.equal(snapshot.players[0]!.x, Math.round(world.players[0]!.x));
  assert.equal(snapshot.players[0]!.y, Math.round(world.players[0]!.y));
  assert.equal(snapshot.players[1]!.hp, 42);
  assert.equal(snapshot.enemies.length, world.enemies.length);
  assert.equal(snapshot.items.length, world.items.length);
});

test('快照：JSON 后仍然很小（4 人 + 满场怪物）', () => {
  const world = makeWorld(4);
  // 塞满怪物与掉落，模拟最坏情况
  for (let i = 0; i < 42; i += 1) {
    spawnEnemy(world, i % 3 === 0 ? 'slime' : i % 3 === 1 ? 'bat' : 'mage', 100 + i * 20, 100 + (i % 7) * 20, true);
  }
  for (let i = 0; i < 40; i += 1) {
    world.items.push({ id: 1000 + i, x: 100 + i * 10, y: 200, kind: 'coin', bob: 0 });
  }
  for (let i = 0; i < 40; i += 1) {
    world.projectiles.push({ id: 2000 + i, x: 100 + i * 5, y: 300, vx: 100, vy: -100, from: 'enemy', dmg: 8, life: 2, color: '#fff' });
  }

  const json = JSON.stringify(packSnapshot(world));
  const bytes = Buffer.byteLength(json, 'utf8');

  // 20Hz 广播，单包控制在 6 KB 以内（4 人 + 42 怪 + 40 掉落 + 40 抛射物是极端情况）
  assert.ok(bytes < 6144, `快照太大：${bytes} 字节`);
  assert.ok(unpackSnapshot(JSON.parse(json)), '极端快照也要能解回来');
});

test('快照：怪物血量上限由 kind + 楼层推导，不需要传输', () => {
  const world = makeWorld(1);
  world.enemies = [];
  spawnEnemy(world, 'boss', 500, 500, true);

  const snapshot = unpackSnapshot(packSnapshot(world));
  assert.ok(snapshot);
  assert.equal(snapshot.enemies.length, 1);
  assert.equal(snapshot.enemies[0]!.kind, 'boss');
  assert.ok(snapshot.enemies[0]!.maxHp > 0);
  assert.equal(snapshot.enemies[0]!.hp, snapshot.enemies[0]!.maxHp, '满血 boss 的 hp 应该等于 maxHp');
});

test('快照：事件能带上并还原', () => {
  const world = makeWorld(2);
  world.events.length = 0; // createWorld 会塞一条 floor-enter，这里先清掉
  world.events.push({ type: 'floor-cleared', floor: 3 });
  world.events.push({ type: 'player-down', seat: 1 });
  world.events.push({ type: 'pickup', x: 320, y: 160, kind: 'heart' });

  const snapshot = unpackSnapshot(packSnapshot(world));
  assert.ok(snapshot);
  assert.equal(snapshot.events.length, 3);
  assert.deepEqual(snapshot.events[0], { type: 'floor-cleared', floor: 3 });
  assert.deepEqual(snapshot.events[1], { type: 'player-down', seat: 1 });
  assert.deepEqual(snapshot.events[2], { type: 'pickup', x: 320, y: 160, kind: 'heart' });
});

test('快照：推进几帧后打包依然自洽', () => {
  const world = makeWorld(2);
  for (let i = 0; i < 30; i += 1) stepWorld(world, 1 / 60);

  const snapshot = unpackSnapshot(packSnapshot(world));
  assert.ok(snapshot);
  assert.equal(snapshot.players.length, 2);
  assert.equal(snapshot.floor, world.floor);
  for (const player of snapshot.players) {
    assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
  }
});

test('快照：恶意 / 畸形输入一律安全丢弃', () => {
  assert.equal(unpackSnapshot(null), null);
  assert.equal(unpackSnapshot(undefined), null);
  assert.equal(unpackSnapshot('nope'), null);
  assert.equal(unpackSnapshot(42), null);
  assert.equal(unpackSnapshot({}), null);
  assert.equal(unpackSnapshot({ v: SNAPSHOT_VERSION + 1, f: 1 }), null, '版本不符要拒绝');
  assert.equal(unpackSnapshot({ v: SNAPSHOT_VERSION, f: 0 }), null, '楼层非法要拒绝');

  // 结构基本对，但某几行是脏数据：跳过脏行、保留干净的
  const messy = unpackSnapshot({
    v: SNAPSHOT_VERSION,
    t: 5,
    f: 2,
    sd: 99,
    ph: 0,
    sc: 10,
    sh: 0,
    p: [[0, 100, 100, 80, 1, 0, 0, 0, 0, 1, 2], 'bad', [1, 'x', 2]],
    e: [[7, 0, 10, 10, 5, 0, 1], [8]],
    b: 'nope',
    i: [[1, 5, 5, 0]],
    ev: [[0, 1, 2, 9], 'bad'],
  });

  assert.ok(messy);
  assert.equal(messy.players.length, 1, '脏的玩家行被跳过');
  assert.equal(messy.enemies.length, 1, '脏的怪物行被跳过');
  assert.equal(messy.projectiles.length, 0);
  assert.equal(messy.items.length, 1);
  assert.equal(messy.events.length, 1);
});
