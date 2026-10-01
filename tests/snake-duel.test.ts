/**
 * 贪吃蛇对战逻辑的单元测试。
 * 运行方式：node --test tests/snake-duel.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_H,
  BOARD_W,
  COLS,
  DIRECTIONS,
  RESPAWN_STEPS,
  ROWS,
  WIN_SCORE,
  advance,
  applyDirection,
  canTurn,
  createDuelState,
  isDuelState,
  spawnSnake,
  startDuel,
  type DirectionName,
  type DuelState,
  type Rng,
  type Seat,
  type Vec,
} from '../src/games/online/snake-duel/logic.ts';

const v = (x: number, y: number): Vec => ({ x, y });
const dirOf = (name: DirectionName): Vec => ({ ...DIRECTIONS[name] });

/** 造一个可控的场地：默认 phase 是 running，可以直接 advance。 */
function makeState(setup: Partial<DuelState> = {}): DuelState {
  return { ...createDuelState(() => 0), phase: 'running', ...setup };
}

/** 一条躺在 y 行、横着的蛇；faceRight = true 时身体在头的左边。 */
function snakeAt(headX: number, y: number, length: number, faceRight: boolean): Vec[] {
  return Array.from({ length }, (_, i) => v(headX - (faceRight ? i : -i), y));
}

/** 可重复的伪随机数（LCG），用来验证「同一份输入 → 同一份结果」。 */
function seededRng(seed: number): Rng {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function occupiedCells(state: DuelState): Set<string> {
  const taken = new Set<string>();
  for (const body of state.snakes) {
    for (const seg of body) taken.add(`${seg.x},${seg.y}`);
  }
  return taken;
}

test('贪吃蛇对战：场地 26×20 格（572 × 440），两条蛇从左右两侧出发', () => {
  assert.equal(BOARD_W, 572);
  assert.equal(BOARD_H, 440);
  assert.equal(COLS, 26);
  assert.equal(ROWS, 20);

  const state = createDuelState(() => 0);

  assert.deepEqual(spawnSnake(0), [v(3, 10), v(2, 10), v(1, 10)], '玩家 1 在左侧，朝右');
  assert.deepEqual(spawnSnake(1), [v(22, 10), v(23, 10), v(24, 10)], '玩家 2 在右侧，朝左');
  assert.deepEqual(state.dirs[0], v(1, 0));
  assert.deepEqual(state.dirs[1], v(-1, 0));
  assert.equal(state.phase, 'ready');
  assert.deepEqual(state.scores, [0, 0]);
  assert.deepEqual(state.alive, [true, true]);
  assert.equal(occupiedCells(state).has(`${state.food.x},${state.food.y}`), false, '食物不能落在蛇身上');

  const running = startDuel(state);
  assert.equal(running.phase, 'running');
  assert.equal(state.phase, 'ready', 'startDuel 不改动原状态');
});

test('吃到食物：加 1 分、变长一节，食物换个空格重新生成', () => {
  const before = makeState({
    snakes: [snakeAt(5, 5, 3, true), snakeAt(20, 15, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    food: v(6, 5),
  });

  const after = advance(before, () => 0.5);

  assert.equal(after.scores[0], 1, '吃到食物 +1 分');
  assert.equal(after.scores[1], 0);
  assert.equal(after.snakes[0].length, 4, '吃到食物应当变长');
  assert.deepEqual(after.snakes[0][0], v(6, 5));
  assert.deepEqual(after.snakes[0].slice(1), [v(5, 5), v(4, 5), v(3, 5)]);

  assert.equal(after.snakes[1].length, 3, '没吃到食物的蛇不增长');
  assert.deepEqual(after.snakes[1][0], v(19, 15));

  assert.notDeepEqual(after.food, v(6, 5), '食物必须在别的格子里重新生成');
  assert.ok(after.food.x >= 0 && after.food.x < COLS && after.food.y >= 0 && after.food.y < ROWS);
  assert.equal(occupiedCells(after).has(`${after.food.x},${after.food.y}`), false);

  assert.equal(after.tick, 1);
  assert.equal(before.scores[0], 0, '原状态不被修改');
  assert.equal(before.snakes[0].length, 3);
  assert.deepEqual(before.food, v(6, 5));
});

test('撞墙：出局、清空蛇身、扣 1 分并开始复活倒计时', () => {
  const before = makeState({
    snakes: [snakeAt(COLS - 1, 4, 3, true), snakeAt(20, 15, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    scores: [2, 1],
    food: v(0, 19),
  });

  const after = advance(before, () => 0);

  assert.equal(after.alive[0], false);
  assert.deepEqual(after.snakes[0], [], '出局时清空蛇身');
  assert.equal(after.scores[0], 1, '出局扣 1 分');
  assert.equal(after.respawn[0], RESPAWN_STEPS);
  assert.equal(after.alive[1], true, '对手不受影响');
  assert.equal(after.scores[1], 1);
});

test('分数不会被扣成负数', () => {
  const before = makeState({
    snakes: [snakeAt(0, 4, 3, false), snakeAt(20, 15, 3, false)],
    dirs: [dirOf('left'), dirOf('left')],
    scores: [0, 0],
    food: v(0, 19),
  });

  const after = advance(before, () => 0);

  assert.equal(after.alive[0], false);
  assert.equal(after.scores[0], 0, '0 分再出局也还是 0 分');
});

test('撞自己身体：出局；追着自己的尾巴走则是安全的', () => {
  const hitSelf = makeState({
    snakes: [
      // 头 (5,5) 朝下走会撞到身体第 3 节 (5,6)
      [v(5, 5), v(4, 5), v(4, 6), v(5, 6), v(6, 6)],
      snakeAt(20, 15, 3, false),
    ],
    dirs: [dirOf('down'), dirOf('left')],
    food: v(0, 19),
  });

  const dead = advance(hitSelf, () => 0);
  assert.equal(dead.alive[0], false);
  assert.deepEqual(dead.snakes[0], []);
  assert.equal(dead.scores[0], 0);

  const chaseTail = makeState({
    snakes: [
      // 头 (6,5) 朝下走的落点 (6,6) 正好是尾巴，尾巴会让出来
      [v(6, 5), v(5, 5), v(5, 6), v(6, 6)],
      snakeAt(20, 15, 3, false),
    ],
    dirs: [dirOf('down'), dirOf('left')],
    food: v(0, 19),
  });

  const safe = advance(chaseTail, () => 0);
  assert.equal(safe.alive[0], true, '进入正要让出来的尾格不算撞到自己');
  assert.deepEqual(safe.snakes[0], [v(6, 6), v(6, 5), v(5, 5), v(5, 6)]);
});

test('撞到对方身体：出局，对方不受影响', () => {
  const before = makeState({
    snakes: [
      snakeAt(5, 5, 2, true), // 头 (5,5) 朝右，下一步 (6,5)
      [v(7, 5), v(6, 5), v(5, 7)], // 头 (7,5) 朝上，下一步 (7,4)
    ],
    dirs: [dirOf('right'), dirOf('up')],
    food: v(0, 19),
  });

  const after = advance(before, () => 0);

  assert.equal(after.alive[0], false, '撞到对方身体要出局');
  assert.deepEqual(after.snakes[0], []);
  assert.equal(after.alive[1], true);
  assert.deepEqual(after.snakes[1], [v(7, 4), v(7, 5), v(6, 5)]);
});

test('两个蛇头撞在同一格：两人都出局，谁都吃不到那颗食物', () => {
  const before = makeState({
    snakes: [snakeAt(5, 5, 3, true), snakeAt(7, 5, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    scores: [1, 1],
    food: v(6, 5),
  });

  const after = advance(before, () => 0.5);

  assert.equal(after.alive[0], false);
  assert.equal(after.alive[1], false);
  assert.deepEqual(after.snakes[0], []);
  assert.deepEqual(after.snakes[1], []);
  assert.deepEqual(after.scores, [0, 0], '两人各扣 1 分');
  assert.deepEqual(after.respawn, [RESPAWN_STEPS, RESPAWN_STEPS]);
  assert.deepEqual(after.food, v(6, 5), '没人吃到，食物留在原地');
});

test('复活：倒计时结束回到出生点，出生点被占就再等一步', () => {
  const waiting = makeState({
    snakes: [[], snakeAt(10, 10, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    alive: [false, true],
    respawn: [1, 0],
    scores: [1, 2],
    food: v(0, 19),
  });

  const back = advance(waiting, () => 0);
  assert.equal(back.alive[0], true);
  assert.deepEqual(back.snakes[0], spawnSnake(0), '复活后回到出生位置');
  assert.equal(back.respawn[0], 0);
  assert.deepEqual(back.scores, [1, 2], '复活本身不再扣分');

  const blocked = makeState({
    snakes: [[], [v(3, 10), v(4, 10), v(5, 10)]],
    dirs: [dirOf('right'), dirOf('left')],
    alive: [false, true],
    respawn: [1, 0],
    food: v(0, 19),
  });

  const still = advance(blocked, () => 0);
  assert.equal(still.alive[0], false, '出生点被占时继续等待');
  assert.deepEqual(still.snakes[0], []);
  assert.equal(still.respawn[0], 0);
});

test('出局后要等 RESPAWN_STEPS 步（约 1.2 秒）才复活', () => {
  let state = makeState({
    snakes: [snakeAt(COLS - 1, 4, 3, true), [v(20, 15), v(20, 16), v(20, 17)]],
    dirs: [dirOf('right'), dirOf('up')],
    scores: [0, 0],
    food: v(0, 19),
  });

  state = advance(state, () => 0);
  assert.equal(state.alive[0], false, '第一步就撞墙出局');
  assert.equal(state.respawn[0], RESPAWN_STEPS);

  for (let step = 1; step <= RESPAWN_STEPS; step += 1) {
    assert.equal(state.alive[0], false, `第 ${step} 步还没到复活时间`);
    state = advance(state, () => 0);
  }

  assert.equal(state.alive[0], true, '倒计时走完就复活');
  assert.deepEqual(state.snakes[0], spawnSnake(0));
  assert.equal(state.scores[0], 0);
});

test('先到 3 分结束整局，结束后不再推进也不接受转向', () => {
  const before = makeState({
    snakes: [snakeAt(5, 5, 3, true), snakeAt(20, 15, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    scores: [WIN_SCORE - 1, 0],
    food: v(6, 5),
  });

  const after = advance(before, () => 0.5);

  assert.equal(after.scores[0], WIN_SCORE);
  assert.equal(after.phase, 'over');
  assert.equal(after.winner, 0);
  assert.equal(advance(after, () => 0), after, '结束后再推进原样返回');
  assert.equal(applyDirection(after, 1, 'up'), after, '结束后不接受转向');
  assert.equal(canTurn(after, 1, 'up'), false);

  const loserWins = makeState({
    snakes: [snakeAt(20, 15, 3, false), snakeAt(5, 5, 3, true)],
    dirs: [dirOf('left'), dirOf('right')],
    scores: [0, WIN_SCORE - 1],
    food: v(6, 5),
  });
  const finished = advance(loserWins, () => 0.5);
  assert.equal(finished.phase, 'over');
  assert.equal(finished.winner, 1, '玩家 2 也能赢');
});

test('转向：方向没变 / 180° 掉头 / 出局期间都不接受', () => {
  const start = makeState({
    snakes: [snakeAt(5, 5, 3, true), snakeAt(20, 15, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    food: v(0, 19),
  });

  assert.equal(applyDirection(start, 0, 'right'), start, '方向没变就原样返回（不必发包）');
  assert.equal(canTurn(start, 0, 'right'), false);
  assert.equal(applyDirection(start, 0, 'left'), start, '不允许 180° 掉头');
  assert.equal(canTurn(start, 0, 'left'), false);

  const turned = applyDirection(start, 0, 'up');
  assert.notEqual(turned, start);
  assert.deepEqual(turned.dirs[0], v(0, -1));
  assert.deepEqual(turned.dirs[1], v(-1, 0), '另一个座位不受影响');
  assert.deepEqual(start.dirs[0], v(1, 0), '原状态不被修改');

  const out = makeState({
    snakes: [[], snakeAt(20, 15, 3, false)],
    dirs: [dirOf('right'), dirOf('left')],
    alive: [false, true],
    food: v(0, 19),
  });
  assert.equal(applyDirection(out, 0, 'up'), out, '出局等待复活时不接受转向');
});

test('确定性：同一步两条蛇都出局时，结算与处理顺序无关', () => {
  const build = (): DuelState =>
    makeState({
      snakes: [
        [v(10, 11), v(10, 12), v(10, 13)], // 头 (10,11) 朝上
        [v(12, 11), v(12, 10), v(12, 9)], // 头 (12,11) 朝下
      ],
      dirs: [dirOf('up'), dirOf('down')],
      scores: [2, 1],
      food: v(0, 19),
    });

  // 两个新头都会落到 (11,11)：头对头，两人同时出局
  const forward = advance(applyDirection(applyDirection(build(), 0, 'right'), 1, 'left'), () => 0.5);
  const reverse = advance(applyDirection(applyDirection(build(), 1, 'left'), 0, 'right'), () => 0.5);

  assert.deepEqual(forward, reverse, '先应用谁的转向不应影响结果');
  assert.deepEqual(forward.alive, [false, false]);
  assert.deepEqual(forward.scores, [1, 0]);
  assert.deepEqual(forward.respawn, [RESPAWN_STEPS, RESPAWN_STEPS]);
  assert.deepEqual(forward.snakes, [[], []]);
  assert.equal(forward.phase, 'running', '只是双双出局，还没分出胜负');
});

/**
 * 一个确定性的「朝食物走」策略：先走差得多的那个轴，转不了再试另一个轴。
 * 用它把对局推演得像真的在玩（会吃到食物、会撞墙出局），但每一步都可复现。
 */
function chaseDirection(state: DuelState, seat: Seat, food: Vec): DirectionName {
  const head = state.snakes[seat][0];
  if (!head) return 'right'; // 出局等待复活，方向会被忽略

  const dx = food.x - head.x;
  const dy = food.y - head.y;
  const horizontal: DirectionName = dx > 0 ? 'right' : 'left';
  const vertical: DirectionName = dy > 0 ? 'down' : 'up';
  const order: DirectionName[] =
    Math.abs(dx) >= Math.abs(dy) ? [horizontal, vertical] : [vertical, horizontal];

  for (const name of order) {
    if (canTurn(state, seat, name)) return name;
  }
  return 'up'; // 三个方向都不行，反正 applyDirection 会拒绝
}

test('确定性：同一份输入序列推演两遍逐字节一致，且与座位处理顺序无关', () => {
  const ROUNDS = 40;
  // 座位 0 一直朝下（撞墙出局→复活→再撞墙），座位 1 追着食物跑。
  // 这条路线会把移动、吃食物（含随机重新生成）、出局、复活全都走一遍。
  const decide = (state: DuelState): [DirectionName, DirectionName] => [
    'down',
    chaseDirection(state, 1, state.food),
  ];

  const rngA = seededRng(99);
  const rngB = seededRng(99);
  let flipped = startDuel(createDuelState(seededRng(7)));
  let normal = startDuel(createDuelState(seededRng(7)));

  let ate = 0;
  let died = 0;
  let respawned = 0;

  for (let step = 0; step < ROUNDS; step += 1) {
    const [d0, d1] = decide(normal);

    // 一份先处理座位 1，另一份永远先处理座位 0
    flipped = applyDirection(applyDirection(flipped, 1, d1), 0, d0);
    normal = applyDirection(applyDirection(normal, 0, d0), 1, d1);

    const before = normal;
    flipped = advance(flipped, rngA);
    normal = advance(normal, rngB);

    assert.deepEqual(flipped, normal, `第 ${step} 步两份推演必须完全一致`);

    if (normal.scores[0] + normal.scores[1] > before.scores[0] + before.scores[1]) ate += 1;
    if (before.alive[0] && !normal.alive[0]) died += 1;
    if (!before.alive[0] && normal.alive[0]) respawned += 1;
  }

  assert.ok(ate > 0, '这条路线应当真的吃到过食物（覆盖食物随机重新生成）');
  assert.ok(died > 0, '这条路线应当真的出局过');
  assert.ok(respawned > 0, '这条路线应当真的复活过');
  assert.equal(normal.tick, ROUNDS);

  // 网络上收到的是 JSON：反序列化之后必须还能推演出同一结果
  const wire: unknown = JSON.parse(JSON.stringify(normal));
  assert.equal(isDuelState(wire), true);
  assert.deepEqual(wire, normal);
  assert.deepEqual(advance(wire, seededRng(5)), advance(normal, seededRng(5)));
});

test('网络数据校验：只有合法的 state 才会被客户端采用', () => {
  const wire = JSON.parse(JSON.stringify(createDuelState(() => 0))) as Record<string, unknown>;

  assert.equal(isDuelState(wire), true);
  assert.equal(isDuelState({ ...wire, snakes: [[], []] }), true, '两条蛇都出局也是合法状态');
  assert.equal(isDuelState({ ...wire, phase: 'ready' }), true);

  const missing: Record<string, unknown> = { ...wire };
  delete missing.alive;

  assert.equal(isDuelState(null), false);
  assert.equal(isDuelState(undefined), false);
  assert.equal(isDuelState('state'), false);
  assert.equal(isDuelState({}), false);
  assert.equal(isDuelState(missing), false, '缺字段应当被拒绝');
  assert.equal(isDuelState({ ...wire, alive: [true] }), false, '存活标记必须成对');
  assert.equal(isDuelState({ ...wire, phase: 'paused' }), false);
  assert.equal(isDuelState({ ...wire, winner: 5 }), false);
  assert.equal(isDuelState({ ...wire, food: { x: 'a', y: 1 } }), false);
});
