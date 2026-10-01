/**
 * 客户端视图层测试：预测、纠偏、插值、换层重建。
 * 这些是「手感」的来源，错了会表现为抖动 / 瞬移 / 穿墙。
 *
 * 注意两个容易写错的地方：
 *   1. toView() 返回的是内部对象的引用，断言前要先取值，否则前后两次读到同一个对象；
 *   2. 客户端有自己的地图副本，测试里铲平地图时必须两边都铲。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SIM_DT, T_FLOOR } from '../src/game/constants.ts';
import { ClientWorld } from '../src/game/netcode.ts';
import { packSnapshot } from '../src/game/snapshot.ts';
import { stepWorld } from '../src/game/sim.ts';
import { createWorld, spawnEnemy } from '../src/game/world.ts';

function makePair(seed = 20261001, playerCount = 2) {
  const players = Array.from({ length: playerCount }, (_, index) => ({
    id: `p${index}`,
    seat: index,
    name: `玩家 ${index + 1}`,
  }));
  const world = createWorld(seed, players);
  world.enemies = [];
  world.items = [];
  world.dungeon.grid.fill(T_FLOOR);

  const client = new ClientWorld(seed, 0);
  client.start(seed);
  client.dungeon.grid.fill(T_FLOOR); // 客户端也有自己的地图副本

  return { world, client };
}

const selfOf = (client: ClientWorld) => ({ x: client.self.x, y: client.self.y });

test('预测：客户端按同样的输入算出同样的位移', () => {
  const { world, client } = makePair();
  const player = world.players[0]!;

  const startX = player.x;
  client.self.x = startX;
  client.self.y = player.y;

  // 两边都按住「右」跑 30 帧
  for (let i = 0; i < 30; i += 1) {
    player.input = { ...player.input, right: true, attack: false, dash: false };
    client.input = { ...client.input, right: true, attack: false, dash: false };
    stepWorld(world, SIM_DT);
    client.update(SIM_DT);
  }

  const hostMoved = player.x - startX;
  const clientMoved = selfOf(client).x - startX;

  assert.ok(hostMoved > 10, '房主应该移动了');
  assert.ok(
    Math.abs(hostMoved - clientMoved) < 1.5,
    `预测位移应该和权威一致（房主 ${hostMoved.toFixed(2)} / 客户端 ${clientMoved.toFixed(2)}）`,
  );
});

test('预测：冲刺也用同一份规则（两边不能各跑各的）', () => {
  const { world, client } = makePair();
  const player = world.players[0]!;
  const startX = player.x;
  client.self.x = startX;
  client.self.y = player.y;

  for (let i = 0; i < 24; i += 1) {
    player.input = { ...player.input, right: true, dash: i === 0, attack: false };
    client.input = { ...client.input, right: true, dash: i === 0, attack: false };
    stepWorld(world, SIM_DT);
    client.update(SIM_DT);
  }

  assert.ok(
    Math.abs(player.x - client.self.x) < 1.5,
    `冲刺后仍应一致（房主 ${player.x.toFixed(2)} / 客户端 ${client.self.x.toFixed(2)}）`,
  );
  assert.ok(player.x - startX > 84, '冲刺应该比走路快');
});

test('纠偏：自己的位置会被快照拉回权威值', () => {
  const { world, client } = makePair();
  const authoritative = world.players[0]!;

  client.self.x = authoritative.x + 40;
  client.self.y = authoritative.y;

  const snapshot = packSnapshot(world);
  client.applySnapshot(snapshot);
  const afterOne = Math.abs(client.self.x - authoritative.x);
  assert.ok(afterOne < 40, `一次快照就应该把差距缩小（剩 ${afterOne.toFixed(2)}）`);

  for (let i = 0; i < 20; i += 1) client.applySnapshot(snapshot);
  const afterMany = Math.abs(client.self.x - authoritative.x);
  // 代码里留了 3 像素死区，避免每帧微调造成抖动
  assert.ok(afterMany <= 3.1, `多次快照后应该进入死区（剩 ${afterMany.toFixed(2)}）`);
});

test('纠偏：偏差过大时直接吸附（避免长时间错位）', () => {
  const { world, client } = makePair();
  const authoritative = world.players[0]!;
  client.self.x = authoritative.x + 500;
  client.applySnapshot(packSnapshot(world));
  assert.ok(Math.abs(client.self.x - authoritative.x) < 1, '超过阈值应该直接吸附');
});

test('插值：队友位置会逐步逼近新的快照位置，而不是瞬移', () => {
  const { world, client } = makePair();
  const teammate = world.players[1]!;

  // 第一份快照：队友出现（新建的远端玩家直接出现在快照位置上，这是对的）
  client.applySnapshot(packSnapshot(world));
  const startX = client.toView({}).players.find((player) => player.seat === 1)!.x;
  assert.ok(Math.abs(startX - teammate.x) < 1, '首次出现应该就在快照位置上');

  // 第二份快照：队友瞬移了 300 像素（房主那边真的挪了）
  teammate.x = startX + 300;
  client.applySnapshot(packSnapshot(world));

  const shownAfterSnapshot = client.toView({}).players.find((player) => player.seat === 1)!.x;
  assert.ok(Math.abs(shownAfterSnapshot - startX) < 1, '刚收到快照时还应该显示在旧位置');

  client.update(SIM_DT);
  const afterOneFrame = client.toView({}).players.find((player) => player.seat === 1)!.x;
  assert.ok(afterOneFrame > shownAfterSnapshot, '应该朝新位置移动');
  assert.ok(afterOneFrame < teammate.x, '第一帧不应该直接到位');

  for (let i = 0; i < 90; i += 1) client.update(SIM_DT);
  const settled = client.toView({}).players.find((player) => player.seat === 1)!.x;
  assert.ok(Math.abs(teammate.x - settled) < 2, `一段时间后应该贴合目标（差 ${Math.abs(teammate.x - settled).toFixed(2)}）`);
});

test('插值：怪物也走同一套平滑逻辑', () => {
  const { world, client } = makePair();
  const enemy = spawnEnemy(world, 'slime', world.dungeon.start.x + 200, world.dungeon.start.y, true);

  client.applySnapshot(packSnapshot(world));
  const startX = client.toView({}).enemies[0]!.x;

  enemy.x = startX + 160;
  client.applySnapshot(packSnapshot(world));
  const before = client.toView({}).enemies[0]!.x;
  assert.ok(Math.abs(before - startX) < 1, '收到新快照时仍显示在旧位置');

  client.update(SIM_DT);
  const after = client.toView({}).enemies[0]!.x;
  assert.ok(after > before, '应该朝新位置移动');
  assert.ok(after < enemy.x, '不该一帧到位');
});

test('换层：快照里的楼层变化会重建地图', () => {
  const { world, client } = makePair();
  const before = client.dungeon.grid;

  // 模拟房主进入第 2 层
  const fresh = createWorld(world.seed, []);
  world.floor = 2;
  world.dungeon = { ...fresh.dungeon, floor: 2 };
  world.players.forEach((player) => {
    player.x = world.dungeon.start.x;
    player.y = world.dungeon.start.y;
  });

  client.applySnapshot(packSnapshot(world));

  assert.equal(client.floor, 2, '楼层应该跟上');
  assert.notEqual(client.dungeon.grid, before, '应该换了地图对象');
  assert.equal(client.dungeon.floor, 2, '新地图的楼层号应该是对的');
});

test('容错：垃圾快照不会破坏客户端状态', () => {
  const { client } = makePair();
  const before = selfOf(client);
  const floor = client.floor;

  assert.equal(client.applySnapshot(null), false);
  assert.equal(client.applySnapshot({ v: 999 }), false);
  assert.equal(client.applySnapshot('garbage'), false);

  assert.deepEqual(selfOf(client), before, '位置不应被垃圾数据改动');
  assert.equal(client.floor, floor, '楼层不应被垃圾数据改动');
});
