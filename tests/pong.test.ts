/**
 * 乒乓球（Pong）联机对战纯逻辑的单元测试。
 *
 * 覆盖：撞左右墙反弹、撞上下球拍按落点改角度、球拍边界、出界得分、
 * 先到 7 分结束、长时间推演的稳定性（不穿场、不穿拍），
 * 以及客户端插值函数会收敛到目标值。
 * 运行方式：node --test tests/pong.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BALL_R,
  BASE_SPEED,
  H,
  MAX_SPEED,
  PADDLE_H,
  PADDLE_W,
  PADDLE_Y0,
  PADDLE_Y1,
  SERVE_DELAY,
  W,
  WIN_SCORE,
  ballIdle,
  canServe,
  clampPaddleX,
  createState,
  interpolateView,
  isSnapshot,
  lerp,
  movePaddle,
  phaseOf,
  requestServe,
  resetMatch,
  serve,
  setViewPaddle,
  stepBall,
  toSnapshot,
  update,
  viewFromSnapshot,
  type PongSnapshot,
  type PongState,
} from '../src/games/online/pong/logic.ts';

const FRAME = 1 / 60;

/** 造一个正在对打的局面：球在中间，按给定速度飞。 */
function playing(vx: number, vy: number): PongState {
  const state = createState();
  state.phase = 'play';
  state.pause = 0;
  state.ball.x = W / 2;
  state.ball.y = H / 2;
  state.ball.vx = vx;
  state.ball.vy = vy;
  return state;
}

test('乒乓球：竖球场、双方球拍居中，开局在中间等发球', () => {
  const state = createState();

  assert.ok(H > W, '球场是竖向的 480 × 640');
  assert.equal(state.phase, 'serve');
  assert.equal(state.score0, 0);
  assert.equal(state.score1, 0);
  assert.equal(state.p0x, W / 2);
  assert.equal(state.p1x, W / 2);
  assert.equal(state.ball.x, W / 2);
  assert.equal(state.ball.y, H / 2);
  assert.equal(state.pause, SERVE_DELAY);

  // 座位 0 的球拍在下方，座位 1 的在上方，两块都完整留在场内
  assert.ok(PADDLE_Y0 > PADDLE_Y1, '座位 0 在下方');
  assert.ok(PADDLE_Y1 >= 0);
  assert.ok(PADDLE_Y0 + PADDLE_H <= H);

  // 得分停顿时还不能发球，停顿结束后才能发
  assert.equal(canServe(state), false);
  assert.equal(serve(state), false, '停顿没结束就不该发球');
  for (let i = 0; i < Math.ceil(SERVE_DELAY / FRAME) + 4; i += 1) update(state, FRAME);
  assert.equal(state.phase, 'play', '停顿结束后房主自动发球');
  assert.ok(Math.hypot(state.ball.vx, state.ball.vy) > BASE_SPEED - 1);
  assert.ok(Math.abs(state.ball.y - H / 2) > 0, '发球后球离开中场');
});

test('乒乓球：撞左右墙会反弹，球不会飞出画面', () => {
  const left = playing(-300, 0);
  left.ball.x = BALL_R - 1;
  stepBall(left, FRAME);
  assert.ok(left.ball.vx > 0, '碰左墙后向右反弹');
  assert.ok(left.ball.x >= BALL_R);

  const right = playing(300, 0);
  right.ball.x = W - BALL_R + 1;
  stepBall(right, FRAME);
  assert.ok(right.ball.vx < 0, '碰右墙后向左反弹');
  assert.ok(right.ball.x <= W - BALL_R);
});

test('乒乓球：打在下球拍上会向上反弹，落点越靠边水平分量越大', () => {
  const center = playing(0, 300);
  center.ball.x = center.p0x;
  center.ball.y = PADDLE_Y0 - BALL_R - 1;
  stepBall(center, FRAME);

  assert.ok(center.ball.vy < 0, '应向上反弹');
  assert.ok(center.ball.y <= PADDLE_Y0, '球被推到球拍上方');
  assert.equal(center.score1, 0, '接住了就不该丢分');

  const rightEdge = playing(0, 300);
  rightEdge.ball.x = rightEdge.p0x + PADDLE_W / 2 - 6;
  rightEdge.ball.y = PADDLE_Y0 - BALL_R - 1;
  stepBall(rightEdge, FRAME);

  assert.ok(rightEdge.ball.vy < 0);
  assert.ok(rightEdge.ball.vx > 0, '打在下球拍的右侧应向右飞出');
  assert.ok(
    Math.abs(rightEdge.ball.vx) > Math.abs(center.ball.vx),
    '越靠边水平速度越大（角度更斜）',
  );

  const leftEdge = playing(0, 300);
  leftEdge.ball.x = leftEdge.p0x - PADDLE_W / 2 + 6;
  leftEdge.ball.y = PADDLE_Y0 - BALL_R - 1;
  stepBall(leftEdge, FRAME);
  assert.ok(leftEdge.ball.vx < 0, '打在下球拍的左侧应向左飞出');
});

test('乒乓球：打在上球拍上会向下反弹', () => {
  const state = playing(0, -300);
  state.ball.x = state.p1x;
  state.ball.y = PADDLE_Y1 + PADDLE_H + BALL_R + 1;
  stepBall(state, FRAME);

  assert.ok(state.ball.vy > 0, '应向下反弹');
  assert.ok(state.ball.y >= PADDLE_Y1 + PADDLE_H, '球被推回球场里');
  assert.equal(state.score0, 0, '上球拍接住了就不该丢分');
});

test('乒乓球：球拍会被夹在场内，越界输入也拉回来', () => {
  const state = createState();

  movePaddle(state, 0, -1000);
  assert.equal(state.p0x, PADDLE_W / 2, '座位 0 不能越过左边界');
  movePaddle(state, 0, 9999);
  assert.equal(state.p0x, W - PADDLE_W / 2, '座位 0 不能越过右边界');

  movePaddle(state, 1, -1000);
  assert.equal(state.p1x, PADDLE_W / 2);
  movePaddle(state, 1, W + 500);
  assert.equal(state.p1x, W - PADDLE_W / 2);

  assert.equal(clampPaddleX(123.5), 123.5);
  assert.equal(clampPaddleX(Number.NaN), W / 2, '脏数据回落到中场');
});

test('乒乓球：球从下边出界算座位 1 得分，从上边出界算座位 0 得分', () => {
  const bottom = playing(0, 300);
  bottom.ball.y = H + 1;
  stepBall(bottom, FRAME);
  assert.equal(bottom.score1, 1, '下边漏球 = 座位 0 丢分');
  assert.equal(bottom.score0, 0);
  assert.equal(bottom.phase, 'serve');
  assert.equal(bottom.pause, SERVE_DELAY, '得分后要停顿一下再发球');
  assert.equal(bottom.ball.x, W / 2);
  assert.equal(bottom.ball.y, H / 2);
  assert.equal(bottom.ball.vy, 0);
  assert.equal(bottom.serveDir, 1, '下一球发给刚失分的一方');

  const top = playing(0, -300);
  top.ball.y = -1;
  stepBall(top, FRAME);
  assert.equal(top.score0, 1, '上边漏球 = 座位 1 丢分');
  assert.equal(top.score1, 0);
  assert.equal(top.serveDir, -1);
});

test('乒乓球：先到 7 分就结束，结束后物理不再推进', () => {
  // 从上边漏出去，座位 0 拿满 7 分
  const state = playing(0, -300);
  state.score0 = WIN_SCORE - 1;
  state.ball.y = -1;
  stepBall(state, FRAME);

  assert.equal(state.score0, WIN_SCORE);
  assert.equal(state.phase, 'over');

  const frozen = { x: state.ball.x, y: state.ball.y };
  for (let i = 0; i < 120; i += 1) update(state, FRAME);
  assert.equal(state.ball.x, frozen.x);
  assert.equal(state.ball.y, frozen.y);
  assert.equal(canServe(state), false, '结束后不能再发球');
  assert.equal(requestServe(state), false);
  assert.equal(serve(state), false);

  const other = playing(0, 300);
  other.score1 = WIN_SCORE - 1;
  other.ball.y = H + 1;
  stepBall(other, FRAME);
  assert.equal(other.score1, WIN_SCORE);
  assert.equal(other.phase, 'over');
});

test('乒乓球：空格请求发球可以跳过得分后的停顿', () => {
  const state = createState();
  assert.equal(requestServe(state), true);
  assert.equal(state.phase, 'play');
  assert.ok(state.ball.vy > 0, '开局朝座位 0（下方）发球');
  assert.ok(Math.abs(state.ball.vx) > 0, '发球带一点角度，不会永远竖直');

  // 得分后立刻按空格，不用等满停顿
  state.ball.y = H + 1;
  update(state, FRAME);
  assert.equal(state.phase, 'serve');
  assert.equal(canServe(state), false);
  assert.equal(requestServe(state), true, '再按一次应该立刻发球');
  assert.equal(state.phase, 'play');
});

test('乒乓球：最大速度 + 最大单帧步长也不会穿过球拍', () => {
  const state = playing(0, MAX_SPEED);
  state.ball.x = state.p0x;
  // 这一步会走 620 × 0.05 = 31px，比球拍 26px 的判定窗口还宽：
  // 不切子步的话会直接从球拍上方跳到下方，变成一次误判漏球
  state.ball.y = PADDLE_Y0 - 8;

  update(state, 0.05);

  assert.ok(state.ball.vy < 0, '贴脸的高速球也要被挡回去');
  assert.equal(state.score1, 0, '不能因为子步切分不够而漏球');
});

test('乒乓球：连续推演 3 分钟，球始终留在场内，比分始终合法', () => {
  const state = createState();
  let escaped = '';
  let scored = 0;
  let prevTotal = 0;
  let maxScore = 0;

  for (let i = 0; i < 60 * 180; i += 1) {
    // 两块球拍自动跟球；每 10 秒切换成「故意漏球」，
    // 让推演覆盖得分、复位、重新发球这些分支
    const careless = Math.floor(i / 600) % 2 === 1;
    const aim = (x: number) => {
      if (careless) return x < W / 2 ? W - PADDLE_W : PADDLE_W;
      return x + 8;
    };
    const target = aim(state.ball.x);
    movePaddle(state, 0, state.p0x + (target - state.p0x) * 0.45);
    movePaddle(state, 1, state.p1x + (target - state.p1x) * 0.4);

    update(state, FRAME);

    const total = state.score0 + state.score1;
    if (total !== prevTotal) {
      scored += total - prevTotal;
      prevTotal = total;
    }

    if (state.phase === 'play') {
      if (state.ball.x < BALL_R - 1e-6 || state.ball.x > W - BALL_R + 1e-6) {
        escaped ||= `x=${state.ball.x}`;
      }
      if (state.ball.y < -1e-6 || state.ball.y > H + 1e-6) {
        escaped ||= `y=${state.ball.y}`;
      }
    }

    maxScore = Math.max(maxScore, state.score0, state.score1);
    assert.ok(state.phase === 'serve' || state.phase === 'play' || state.phase === 'over');
    assert.ok(state.score0 <= WIN_SCORE && state.score1 <= WIN_SCORE, '比分不该超过 7');

    if (state.phase === 'over') {
      resetMatch(state);
      prevTotal = 0;
    }
  }

  assert.equal(escaped, '', '球不应该越过左右墙，也不该在对打中跑出端线');
  assert.ok(scored > 0, '这段时间里应该有人得分');
  // 3 分钟足够打满好几局；有人到 7 分说明「结束 → 复位 → 重新发球」都跑到了
  assert.ok(maxScore >= WIN_SCORE, `应该有人打满 ${WIN_SCORE} 分，实际最高 ${maxScore}`);
});

test('乒乓球：客户端插值每帧靠近目标位置，最终收敛', () => {
  const target: PongSnapshot = { ballX: 360, ballY: 520, p0x: 120, p1x: 300, score0: 2, score1: 1 };
  const view = viewFromSnapshot({ ballX: 0, ballY: 0, p0x: 0, p1x: 0, score0: 2, score1: 1 });

  interpolateView(view, target, 0.25);
  assert.ok(Math.abs(view.ballX - 90) < 1e-9, '第一帧走 25%');
  assert.ok(view.ballX < target.ballX && view.ballY < target.ballY, '不会过冲');

  for (let i = 0; i < 240; i += 1) interpolateView(view, target, 0.25);
  assert.ok(Math.abs(view.ballX - target.ballX) < 1e-3);
  assert.ok(Math.abs(view.ballY - target.ballY) < 1e-3);
  assert.ok(Math.abs(view.p0x - target.p0x) < 1e-3);
  assert.ok(Math.abs(view.p1x - target.p1x) < 1e-3);

  assert.equal(lerp(0, 100, 5), 100, 'ratio 会被夹到 [0,1]');
  assert.equal(lerp(100, 0, -1), 100);
  assert.equal(lerp(10, 30, 0.5), 20);
});

test('乒乓球：比分变化说明球被放回中间，插值要直接吸附', () => {
  const view = viewFromSnapshot({ ballX: 400, ballY: 80, p0x: 0, p1x: 0, score0: 3, score1: 2 });
  const target: PongSnapshot = {
    ballX: W / 2,
    ballY: H / 2,
    p0x: 240,
    p1x: 200,
    score0: 4,
    score1: 2,
  };

  interpolateView(view, target, 0.25);

  assert.equal(view.ballX, target.ballX, '得分后球直接回到中间，不横穿球场');
  assert.equal(view.ballY, target.ballY);
  assert.equal(view.score0, 4);
  assert.equal(view.score1, 2);
  assert.ok(Math.abs(view.p0x - 60) < 1e-9, '球拍照常插值：0 + 240 × 25%');
  assert.ok(Math.abs(view.p1x - 50) < 1e-9, '球拍照常插值：0 + 200 × 25%');
});

test('乒乓球：快照校验与客户端局面推断', () => {
  const snap: PongSnapshot = { ballX: 1, ballY: 2, p0x: 3, p1x: 4, score0: 0, score1: 0 };

  assert.equal(isSnapshot(snap), true);
  assert.equal(isSnapshot(null), false);
  assert.equal(isSnapshot({ ...snap, ballY: 'x' }), false);
  assert.equal(isSnapshot({ ballX: 1 }), false);
  assert.equal(isSnapshot({ ...snap, p0x: Number.NaN }), false);

  assert.equal(phaseOf({ ...snap, score0: WIN_SCORE }, true), 'over');
  assert.equal(phaseOf({ ...snap, score1: WIN_SCORE }, false), 'over');
  assert.equal(phaseOf(snap, true), 'serve');
  assert.equal(phaseOf(snap, false), 'play');

  assert.equal(ballIdle(null, snap), false, '还没有上一帧时先当作对打中');
  assert.equal(ballIdle(snap, { ...snap }), true);
  assert.equal(ballIdle(snap, { ...snap, ballX: snap.ballX + 30 }), false);
});

test('乒乓球：渲染视图里自己的球拍用本地值，且同样被夹在场内', () => {
  const view = viewFromSnapshot({ ballX: 0, ballY: 0, p0x: 100, p1x: 100, score0: 0, score1: 0 });

  setViewPaddle(view, 1, 5000);
  assert.equal(view.p1x, W - PADDLE_W / 2);
  assert.equal(view.p0x, 100, '只动自己那一侧');

  setViewPaddle(view, 0, -50);
  assert.equal(view.p0x, PADDLE_W / 2);
  assert.equal(view.p1x, W - PADDLE_W / 2);
});

test('乒乓球：快照字段与复位', () => {
  const state = createState();
  state.score0 = 5;
  state.score1 = 6;
  state.p0x = 100;
  state.p1x = 400;
  state.phase = 'over';

  resetMatch(state);
  assert.equal(state.score0, 0);
  assert.equal(state.score1, 0);
  assert.equal(state.p0x, W / 2);
  assert.equal(state.p1x, W / 2);
  assert.equal(state.phase, 'serve');

  assert.deepEqual(toSnapshot(state), {
    ballX: W / 2,
    ballY: H / 2,
    p0x: W / 2,
    p1x: W / 2,
    score0: 0,
    score1: 0,
  });
});
