/**
 * 打砖块物理逻辑的单元测试。
 *
 * 覆盖球与墙 / 挡板 / 砖块的碰撞、掉球扣命、过关与长时间推演的稳定性。
 * 运行方式：npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL_R,
  H,
  PADDLE_W,
  PADDLE_Y,
  W,
  aliveBricks,
  buildBricks,
  createState,
  launch,
  stepBall,
  update,
  type BreakoutState,
} from '../src/games/breakout/logic.ts';

/** 造一个已经发球、正在运行的局面。 */
function running(): BreakoutState {
  const state = createState();
  launch(state);
  return state;
}

/** 把球放到某块砖的正下方，朝正上方运动。 */
function aimAtBrick(state: BreakoutState, index: number): void {
  const brick = state.bricks[index]!;
  state.ball.x = brick.x + brick.w / 2;
  state.ball.y = brick.y + brick.h + BALL_R + 1;
  state.ball.vx = 0;
  state.ball.vy = -300;
}

const FRAME = 1 / 60;

test('打砖块：初始为待发球状态，第 1 关 4 行 8 列砖块', () => {
  const state = createState();
  assert.equal(state.phase, 'ready');
  assert.equal(state.lives, 3);
  assert.equal(state.score, 0);
  assert.equal(state.level, 1);
  assert.equal(state.bricks.length, 4 * 8);
  assert.equal(aliveBricks(state), 32);
  // 待发球时球吸附在挡板上
  assert.equal(state.ball.x, state.paddleCx);
  assert.equal(state.ball.y, PADDLE_Y - BALL_R - 1);
});

test('打砖块：关卡越高砖块行数越多，球速也更快', () => {
  assert.equal(buildBricks(1).length, 4 * 8);
  assert.equal(buildBricks(2).length, 5 * 8);
  assert.equal(buildBricks(10).length, 7 * 8, '行数上限为 7');
  assert.ok(createState(3).speed > createState(1).speed);
});

test('打砖块：发球后进入运行状态并向上飞出', () => {
  const state = createState();
  launch(state);
  assert.equal(state.phase, 'running');
  assert.ok(state.ball.vy < 0, '发球后向上运动');
  assert.ok(Math.abs(state.ball.vx) < state.speed, '水平分量不能超过总速度');
});

test('打砖块：撞碎砖块会加分并向下反弹', () => {
  const state = running();
  const brick = state.bricks[0]!;

  aimAtBrick(state, 0);
  stepBall(state, FRAME);

  assert.equal(brick.alive, false, '砖块应被打碎');
  assert.equal(state.score, 10, '第 1 关每块砖 10 分');
  assert.ok(state.ball.vy > 0, '撞到砖块后应向下反弹');
  assert.equal(aliveBricks(state), 31);
  assert.ok(state.particles.length > 0, '打碎砖块应有粒子效果');
});

test('打砖块：从侧面撞砖块时水平方向反弹', () => {
  const state = running();
  // 用第一行第一列：它左边没有别的砖块，才能干净地测「侧面撞击」
  const brick = state.bricks[0]!;

  state.ball.x = brick.x - BALL_R - 0.5;
  state.ball.y = brick.y + brick.h / 2;
  state.ball.vx = 300;
  state.ball.vy = 0;

  stepBall(state, FRAME);

  assert.equal(brick.alive, false);
  assert.equal(brick.x, state.bricks[0]!.x);
  assert.ok(state.ball.vx < 0, '从左侧撞上来应向左反弹');
  assert.equal(state.ball.vy, 0, '纯水平撞击不应改变竖直方向');
});

test('打砖块：打在挡板正中几乎垂直反弹，打在边缘则角度更大', () => {
  const center = running();
  center.ball.x = center.paddleCx;
  center.ball.y = PADDLE_Y - BALL_R - 1;
  center.ball.vx = 0;
  center.ball.vy = 300;
  stepBall(center, FRAME);
  assert.ok(center.ball.vy < 0, '应向上反弹');
  assert.ok(Math.abs(center.ball.vx) < 1, '正中命中时几乎没有水平速度');

  const edge = running();
  edge.ball.x = edge.paddleCx + PADDLE_W / 2 - 6;
  edge.ball.y = PADDLE_Y - BALL_R - 1;
  edge.ball.vx = 0;
  edge.ball.vy = 300;
  stepBall(edge, FRAME);
  assert.ok(edge.ball.vy < 0, '应向上反弹');
  assert.ok(edge.ball.vx > 0, '打在挡板右侧应向右飞出');
  assert.ok(Math.abs(edge.ball.vx) > Math.abs(center.ball.vx), '越靠边水平速度越大');
});

test('打砖块：球会被左右墙和顶部挡回来，不会飞出画面', () => {
  const state = running();

  state.ball.x = BALL_R - 1;
  state.ball.y = 300;
  state.ball.vx = -300;
  state.ball.vy = 100;
  stepBall(state, FRAME);
  assert.ok(state.ball.vx > 0, '碰左墙后向右反弹');
  assert.ok(state.ball.x >= BALL_R);

  state.ball.x = W - BALL_R + 1;
  state.ball.vx = 300;
  stepBall(state, FRAME);
  assert.ok(state.ball.vx < 0, '碰右墙后向左反弹');
  assert.ok(state.ball.x <= W - BALL_R);

  state.ball.y = BALL_R - 1;
  state.ball.x = W / 2;
  state.ball.vy = -300;
  stepBall(state, FRAME);
  assert.ok(state.ball.vy > 0, '碰顶部后向下反弹');
  assert.ok(state.ball.y >= BALL_R);
});

test('打砖块：球掉出底部扣一条命并回到挡板', () => {
  const state = running();
  state.ball.y = H + BALL_R + 1;
  state.ball.vy = 200;

  stepBall(state, FRAME);

  assert.equal(state.lives, 2);
  assert.equal(state.phase, 'ready');
  assert.equal(state.ball.x, state.paddleCx);
  assert.equal(state.ball.vy, 0);
});

test('打砖块：三条命用完游戏结束', () => {
  const state = running();
  for (let i = 0; i < 3; i += 1) {
    state.ball.y = H + BALL_R + 1;
    state.ball.vy = 200;
    stepBall(state, FRAME);
  }
  assert.equal(state.lives, 0);
  assert.equal(state.phase, 'over');
});

test('打砖块：打光所有砖块后过关并拿到奖励分', () => {
  const state = running();
  state.bricks.forEach((brick, index) => {
    if (index !== 0) brick.alive = false;
  });

  aimAtBrick(state, 0);
  stepBall(state, FRAME);

  assert.equal(aliveBricks(state), 0);
  assert.equal(state.phase, 'cleared');
  assert.equal(state.score, 10 + 120 + 1 * 40, '过关奖励 = 120 + 关卡 × 40');
});

test('打砖块：待发球时球跟随挡板，挡板会停在目标位置', () => {
  const state = createState();
  state.targetCx = 100;
  for (let i = 0; i < 60; i += 1) update(state, FRAME, { left: false, right: false });

  assert.ok(Math.abs(state.paddleCx - 100) < 1, '挡板最终停在目标位置');
  assert.ok(Math.abs(state.ball.x - state.paddleCx) < 1e-6, '球始终吸附在挡板上');
});

test('打砖块：按住方向键挡板会移动，且不会移出画面', () => {
  const state = createState();
  const start = state.paddleCx;

  for (let i = 0; i < 30; i += 1) update(state, FRAME, { left: true, right: false });
  assert.ok(state.paddleCx < start - 20, '按住左键应向左移动');

  for (let i = 0; i < 300; i += 1) update(state, FRAME, { left: true, right: false });
  assert.ok(state.paddleCx >= PADDLE_W / 2 - 1e-6, '挡板不能越过左边界');

  for (let i = 0; i < 600; i += 1) update(state, FRAME, { left: false, right: true });
  assert.ok(state.paddleCx <= W - PADDLE_W / 2 + 1e-6, '挡板不能越过右边界');
});

test('打砖块：连续推演 2 分钟，球不会穿墙，且能打碎砖块', () => {
  const state = createState();
  const keys = { left: false, right: false };
  let escaped = false;

  // 60 帧/秒 × 120 秒：覆盖多局、多关、多次掉球
  for (let i = 0; i < 60 * 120; i += 1) {
    update(state, FRAME, keys);
    if (state.phase === 'ready') launch(state);

    if (
      state.ball.x < BALL_R - 0.5 ||
      state.ball.x > W - BALL_R + 0.5 ||
      state.ball.y < BALL_R - 0.5
    ) {
      escaped = true;
      break;
    }
  }

  assert.equal(escaped, false, '球不应该越过左右墙或顶部');
  assert.ok(state.score > 0, '这段时间内至少应该打碎过砖块');
  assert.ok(
    state.phase === 'running' || state.phase === 'ready' || state.phase === 'cleared' || state.phase === 'over',
    `推演结束时状态应合法，实际为 ${state.phase}`,
  );
  assert.ok(state.lives >= 0);
});
