/**
 * 打砖块的纯逻辑（不依赖 React 和 DOM，可以直接单元测试）。
 *
 * 坐标系统：逻辑画布固定 480 × 620，显示时由 CSS 等比缩放，
 * 所以挡板位置只需要一个中心点 x 就能描述。
 */

// 注意：这里写全 .ts 后缀，是因为这个模块会被 Node 直接跑单元测试，
// 而 Node 的类型剥离（type stripping）不会像打包器那样自动补全扩展名。
import { clamp } from '../../lib/math.ts';

export const W = 480;
export const H = 620;

export const PADDLE_W = 88;
export const PADDLE_H = 12;
export const PADDLE_Y = H - 36;

export const BALL_R = 7;

export const COLS = 8;
export const BRICK_H = 20;
export const BRICK_GAP = 6;
export const BRICK_TOP = 64;
export const BRICK_LEFT = 16;
export const BRICK_W = (W - BRICK_LEFT * 2 - BRICK_GAP * (COLS - 1)) / COLS;

export const ROW_COLORS = ['#f87171', '#fbbf24', '#4ade80', '#38bdf8', '#c084fc', '#f472b6', '#facc15'];
export const MAX_BALL_SPEED = 640;

/** 挡板跟随鼠标 / 触屏的最大速度（像素/秒），键盘按住时用。 */
const PADDLE_KEY_SPEED = 520;
/** 挡板每帧向目标位置插值的比例系数。 */
const PADDLE_EASE = 18;

export type Brick = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  alive: boolean;
};

export type Ball = { x: number; y: number; vx: number; vy: number };

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
};

export type Phase = 'ready' | 'running' | 'paused' | 'over' | 'cleared';

export type Keys = { left: boolean; right: boolean };

export type BreakoutState = {
  phase: Phase;
  score: number;
  lives: number;
  level: number;
  /** 挡板当前中心 x */
  paddleCx: number;
  /** 挡板想去的位置（鼠标 / 键盘设定） */
  targetCx: number;
  ball: Ball;
  bricks: Brick[];
  particles: Particle[];
  /** 本关的球速基准值 */
  speed: number;
};

/** 第 1 关 4 行，之后每关多一行，最多 7 行。 */
export function brickRows(level: number): number {
  return Math.min(3 + level, 7);
}

export function buildBricks(level: number): Brick[] {
  const rows = brickRows(level);
  const bricks: Brick[] = [];
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      bricks.push({
        x: BRICK_LEFT + c * (BRICK_W + BRICK_GAP),
        y: BRICK_TOP + r * (BRICK_H + BRICK_GAP),
        w: BRICK_W,
        h: BRICK_H,
        color: ROW_COLORS[r % ROW_COLORS.length]!,
        alive: true,
      });
    }
  }
  return bricks;
}

export function baseSpeed(level: number): number {
  return 250 + (level - 1) * 22;
}

/** 把球吸附回挡板上（发球前、掉球后的状态）。 */
export function attachBall(state: BreakoutState): void {
  state.ball.x = state.paddleCx;
  state.ball.y = PADDLE_Y - BALL_R - 1;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

export function createState(level = 1, score = 0, lives = 3): BreakoutState {
  const state: BreakoutState = {
    phase: 'ready',
    score,
    lives,
    level,
    paddleCx: W / 2,
    targetCx: W / 2,
    ball: { x: W / 2, y: PADDLE_Y - BALL_R - 1, vx: 0, vy: 0 },
    bricks: buildBricks(level),
    particles: [],
    speed: baseSpeed(level),
  };
  attachBall(state);
  return state;
}

/** 发球：随机一个与竖直方向夹角不超过 26° 的方向向上飞出。 */
export function launch(state: BreakoutState): void {
  if (state.phase !== 'ready') return;
  const angle = Math.random() * 0.9 - 0.45;
  state.ball.vx = Math.sin(angle) * state.speed;
  state.ball.vy = -Math.cos(angle) * state.speed;
  state.phase = 'running';
}

function burst(state: BreakoutState, x: number, y: number, color: string): void {
  for (let i = 0; i < 10; i += 1) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 150;
    state.particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5,
      max: 0.5,
      color,
    });
  }
  const excess = state.particles.length - 240;
  if (excess > 0) state.particles.splice(0, excess);
}

function updateParticles(state: BreakoutState, dt: number): void {
  for (let i = state.particles.length - 1; i >= 0; i -= 1) {
    const particle = state.particles[i]!;
    particle.life -= dt;
    if (particle.life <= 0) {
      state.particles.splice(i, 1);
      continue;
    }
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += 320 * dt;
    particle.vx *= 0.98;
  }
}

/** 球前进一小步，并处理墙、挡板、砖块和掉出底部的判定。 */
export function stepBall(state: BreakoutState, dt: number): void {
  const ball = state.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // 左右上三面墙
  if (ball.x - BALL_R < 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  }
  if (ball.x + BALL_R > W) {
    ball.x = W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }
  if (ball.y - BALL_R < 0) {
    ball.y = BALL_R;
    ball.vy = Math.abs(ball.vy);
  }

  // 挡板：按落点相对中心的偏移决定反弹角度，越靠边角度越大（最大 60°）
  const halfPaddle = PADDLE_W / 2;
  if (
    ball.vy > 0 &&
    ball.y + BALL_R >= PADDLE_Y &&
    ball.y - BALL_R <= PADDLE_Y + PADDLE_H &&
    ball.x >= state.paddleCx - halfPaddle - BALL_R &&
    ball.x <= state.paddleCx + halfPaddle + BALL_R
  ) {
    ball.y = PADDLE_Y - BALL_R;
    const offset = clamp((ball.x - state.paddleCx) / halfPaddle, -1, 1);
    const angle = offset * (Math.PI / 3);
    const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.015 + 4, MAX_BALL_SPEED);
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.abs(Math.cos(angle) * speed);
  }

  // 砖块：先比较两个轴上的重叠深度，判断球是从哪个方向撞上来的
  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    if (
      ball.x + BALL_R < brick.x ||
      ball.x - BALL_R > brick.x + brick.w ||
      ball.y + BALL_R < brick.y ||
      ball.y - BALL_R > brick.y + brick.h
    ) {
      continue;
    }

    const overlapX = Math.min(ball.x + BALL_R - brick.x, brick.x + brick.w - (ball.x - BALL_R));
    const overlapY = Math.min(ball.y + BALL_R - brick.y, brick.y + brick.h - (ball.y - BALL_R));

    if (overlapX < overlapY) {
      ball.vx = -ball.vx;
      ball.x += ball.vx > 0 ? overlapX : -overlapX;
    } else {
      ball.vy = -ball.vy;
      ball.y += ball.vy > 0 ? overlapY : -overlapY;
    }

    brick.alive = false;
    state.score += 10 + (state.level - 1) * 5;
    burst(state, brick.x + brick.w / 2, brick.y + brick.h / 2, brick.color);
    break;
  }

  // 掉出底部：扣命，还有命就回到挡板上待发球
  if (ball.y - BALL_R > H) {
    state.lives -= 1;
    if (state.lives <= 0) {
      state.phase = 'over';
    } else {
      state.phase = 'ready';
      attachBall(state);
    }
    return;
  }

  // 打光所有砖块就过关
  if (state.bricks.every((brick) => !brick.alive)) {
    state.score += 120 + state.level * 40;
    state.phase = 'cleared';
  }
}

/**
 * 推进一帧：挡板移动、粒子、球的小步前进。
 * dt 单位是秒，调用方需要自己限制最大值，避免切后台回来后一帧跳太远。
 */
export function update(state: BreakoutState, dt: number, keys: Keys): void {
  updateParticles(state, dt);

  if (keys.left) state.targetCx -= PADDLE_KEY_SPEED * dt;
  if (keys.right) state.targetCx += PADDLE_KEY_SPEED * dt;
  state.targetCx = clamp(state.targetCx, PADDLE_W / 2, W - PADDLE_W / 2);
  state.paddleCx += (state.targetCx - state.paddleCx) * Math.min(1, dt * PADDLE_EASE);

  if (state.phase === 'ready') {
    attachBall(state);
    return;
  }
  if (state.phase !== 'running') return;

  // 按位移切分子步，高速时也不会穿过砖块
  const speed = Math.hypot(state.ball.vx, state.ball.vy) || state.speed;
  const steps = clamp(Math.ceil((speed * dt) / 4), 1, 8);
  for (let i = 0; i < steps && state.phase === 'running'; i += 1) {
    stepBall(state, dt / steps);
  }
}

export function aliveBricks(state: BreakoutState): number {
  return state.bricks.reduce((count, brick) => (brick.alive ? count + 1 : count), 0);
}
