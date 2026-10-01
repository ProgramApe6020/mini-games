/**
 * 乒乓球（Pong）联机对战的纯逻辑（不依赖 React 和 DOM，可以直接单元测试）。
 *
 * 坐标系：逻辑画布固定 480 × 640 的竖球场，显示时由 CSS 等比缩放，
 * 所以一块球拍只需要一个中心 x 就能描述。
 *
 * 座位约定：座位 0（房主）的球拍在**下方**，座位 1（客户端）的球拍在**上方**。
 * 球只在左右两面墙上反弹；从上边或下边越界，就算对面得分。
 *
 * 网络模型（房主权威）：
 *  - 房主用 `update()` 推进物理，再用 `toSnapshot()` 广播出去；
 *  - 客户端只做两件事：把收到的快照插值渲染（`interpolateView`），
 *    以及把自己的球拍位置 `input` 给房主。
 * 所以下面这组函数被两端共用，但没有一处依赖浏览器环境。
 */

// 写全 .ts 后缀：Node 直接执行 .ts 跑单元测试时，不像打包器那样自动补扩展名
import { clamp } from '../../../lib/math.ts';
import type { Seat } from '../../../lib/net/types';

export const W = 480;
export const H = 640;

/** 横放的球拍：上下各一块，只沿 x 轴左右移动。 */
export const PADDLE_W = 88;
export const PADDLE_H = 12;
/** 球拍到最近一条端线的距离 */
export const PADDLE_MARGIN = 26;

/** 座位 0 的球拍在下方，座位 1 的球拍在上方。 */
export const PADDLE_Y0 = H - PADDLE_MARGIN - PADDLE_H;
export const PADDLE_Y1 = PADDLE_MARGIN;

export const BALL_R = 7;

/** 先到 7 分获胜 */
export const WIN_SCORE = 7;

/** 发球速度、每次击球提速、速度上限（像素/秒） */
export const BASE_SPEED = 300;
export const MAX_SPEED = 620;
const SPEED_UP = 1.035;
const SPEED_ADD = 6;

/** 打在球拍最边缘时最多偏转 60° */
const MAX_BOUNCE = Math.PI / 3;
/** 正中命中时也留一点点角度，避免双方不动时出现永远竖直的死循环对拉 */
const MIN_BOUNCE_RATIO = 0.08;

/** 得分后球回到中间，停顿这么久（秒）后由房主自动发球 */
export const SERVE_DELAY = 0.9;

/** 键盘控制球拍的速度（像素/秒） */
export const PADDLE_KEY_SPEED = 460;

/** 客户端插值系数：约等于 60 帧下每帧 25%，按 dt 折算所以与帧率无关 */
export const INTERP_RATE = 15;

/**
 * 发球角度（弧度）。固定成一张表而不是随机，是为了让物理可复现、测试稳定。
 * 同时保证第一球不会正好竖直，双方都得动起来。
 */
const SERVE_ANGLES: readonly number[] = [0.16, -0.22, 0.09, -0.13, 0.25, -0.07, 0.2, -0.18];

export type PongPhase = 'serve' | 'play' | 'over';

export type PongState = {
  phase: PongPhase;
  ball: { x: number; y: number; vx: number; vy: number };
  /** 座位 0（下方）球拍的中心 x */
  p0x: number;
  /** 座位 1（上方）球拍的中心 x */
  p1x: number;
  score0: number;
  score1: number;
  /** 距离可以发球还剩多少秒（phase 为 serve 时才有意义） */
  pause: number;
  /** 下一球往哪边发：+1 向下（发给座位 0），-1 向上（发给座位 1） */
  serveDir: 1 | -1;
  /** 已经发过多少个球，用来轮换发球角度 */
  serves: number;
  /** 当前球速，只用于展示与子步切分 */
  speed: number;
};

/**
 * 房主广播给客户端的快照。字段刻意保持扁平、最小：
 * 客户端不需要知道发球倒计时之类的内部状态，靠球有没有动就能判断出来。
 */
export type PongSnapshot = {
  ballX: number;
  ballY: number;
  p0x: number;
  p1x: number;
  score0: number;
  score1: number;
};

/** 客户端渲染用的平滑视图，和快照同构。 */
export type PongView = PongSnapshot;

export function createState(): PongState {
  const state: PongState = {
    phase: 'serve',
    ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
    p0x: W / 2,
    p1x: W / 2,
    score0: 0,
    score1: 0,
    pause: SERVE_DELAY,
    serveDir: 1,
    serves: 0,
    speed: BASE_SPEED,
  };
  return state;
}

/** 复位成一局新比赛：比分清零、球回到中间、双方球拍回中间。 */
export function resetMatch(state: PongState): void {
  const fresh = createState();
  state.phase = fresh.phase;
  state.ball = fresh.ball;
  state.p0x = fresh.p0x;
  state.p1x = fresh.p1x;
  state.score0 = fresh.score0;
  state.score1 = fresh.score1;
  state.pause = fresh.pause;
  state.serveDir = fresh.serveDir;
  state.serves = fresh.serves;
  state.speed = fresh.speed;
}

/** 球拍中心 x 的合法范围：整块球拍必须留在场内。 */
export function clampPaddleX(x: number): number {
  const safe = Number.isFinite(x) ? x : W / 2;
  return clamp(safe, PADDLE_W / 2, W - PADDLE_W / 2);
}

/** 把某一边的球拍移到指定中心 x（会被夹在场内）。 */
export function movePaddle(state: PongState, seat: Seat, x: number): void {
  if (seat === 0) state.p0x = clampPaddleX(x);
  else state.p1x = clampPaddleX(x);
}

/** 把球放回球场正中间并停住（发球前、得分后）。 */
export function centerBall(state: PongState): void {
  state.ball.x = W / 2;
  state.ball.y = H / 2;
  state.ball.vx = 0;
  state.ball.vy = 0;
}

/** 现在能不能发球：处于发球阶段、并且得分后的停顿已经结束。 */
export function canServe(state: PongState): boolean {
  return state.phase === 'serve' && state.pause <= 0;
}

/**
 * 发球。竖直分量取 `dir`（+1 向下、-1 向上），水平分量由固定的角度表决定。
 * 不满足条件时返回 false，房主可以直接忽略这次请求。
 */
export function serve(state: PongState, dir: 1 | -1 = state.serveDir): boolean {
  if (!canServe(state)) return false;
  const angle = SERVE_ANGLES[state.serves % SERVE_ANGLES.length]!;
  state.ball.x = W / 2;
  state.ball.y = H / 2;
  state.ball.vx = Math.sin(angle) * BASE_SPEED;
  state.ball.vy = dir * Math.cos(angle) * BASE_SPEED;
  state.speed = BASE_SPEED;
  state.phase = 'play';
  state.serves += 1;
  return true;
}

/**
 * 请求发球（双方按空格、客户端发 serve 消息时走这里）：
 * 还在得分停顿时直接跳过剩余停顿，立刻把球发出去。
 */
export function requestServe(state: PongState): boolean {
  if (state.phase !== 'serve') return false;
  state.pause = 0;
  return serve(state);
}

/** 得分：把球放回中间、记录发球方向，够了 7 分就直接结束。 */
export function scorePoint(state: PongState, scorer: Seat): void {
  if (scorer === 0) state.score0 += 1;
  else state.score1 += 1;

  centerBall(state);
  state.speed = BASE_SPEED;
  // 下一球发给刚失分的一方，让他有机会接
  state.serveDir = scorer === 0 ? -1 : 1;

  if (state.score0 >= WIN_SCORE || state.score1 >= WIN_SCORE) {
    state.phase = 'over';
    state.pause = 0;
    return;
  }
  state.phase = 'serve';
  state.pause = SERVE_DELAY;
}

/** 球拍反弹：落点越靠边，水平分量越大（最多 60°），并略微提速。 */
function bounce(state: PongState, offsetX: number, dir: 1 | -1): void {
  const raw = clamp(offsetX / (PADDLE_W / 2), -1, 1);
  const magnitude = Math.max(Math.abs(raw), MIN_BOUNCE_RATIO);
  const sign = raw !== 0 ? Math.sign(raw) : state.serves % 2 === 0 ? 1 : -1;
  const angle = sign * magnitude * MAX_BOUNCE;
  const speed = Math.min(Math.hypot(state.ball.vx, state.ball.vy) * SPEED_UP + SPEED_ADD, MAX_SPEED);

  state.speed = speed;
  state.ball.vx = Math.sin(angle) * speed;
  state.ball.vy = dir * Math.abs(Math.cos(angle)) * speed;
}

/**
 * 球前进一小步，处理左右墙、上下球拍和出界得分。
 * 调用方需要自己把 dt 切得足够小（见 `update`）。
 */
export function stepBall(state: PongState, dt: number): void {
  const ball = state.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // 左右两面墙：球完全进来
  if (ball.x - BALL_R < 0) {
    ball.x = BALL_R;
    ball.vx = Math.abs(ball.vx);
  } else if (ball.x + BALL_R > W) {
    ball.x = W - BALL_R;
    ball.vx = -Math.abs(ball.vx);
  }

  // 下方球拍（座位 0）
  if (
    ball.vy > 0 &&
    ball.y + BALL_R >= PADDLE_Y0 &&
    ball.y - BALL_R <= PADDLE_Y0 + PADDLE_H &&
    Math.abs(ball.x - state.p0x) <= PADDLE_W / 2 + BALL_R
  ) {
    ball.y = PADDLE_Y0 - BALL_R;
    bounce(state, ball.x - state.p0x, -1);
  } else if (
    // 上方球拍（座位 1）
    ball.vy < 0 &&
    ball.y - BALL_R <= PADDLE_Y1 + PADDLE_H &&
    ball.y + BALL_R >= PADDLE_Y1 &&
    Math.abs(ball.x - state.p1x) <= PADDLE_W / 2 + BALL_R
  ) {
    ball.y = PADDLE_Y1 + PADDLE_H + BALL_R;
    bounce(state, ball.x - state.p1x, 1);
  }

  // 球心越过端线就算出界：下边漏球 = 座位 0 丢分，上边漏球 = 座位 1 丢分
  if (ball.y < 0) {
    scorePoint(state, 0);
    return;
  }
  if (ball.y > H) {
    scorePoint(state, 1);
  }
}

/**
 * 推进一帧。dt 单位是秒，调用方必须把单帧上限压在 0.05s 以内
 * （切到后台再回来时 dt 会很大，一帧就能穿场）。
 */
export function update(state: PongState, dt: number): void {
  if (!(dt > 0)) return;
  if (state.phase === 'over') return;

  if (state.phase === 'serve') {
    if (state.pause > 0) {
      state.pause = Math.max(0, state.pause - dt);
      centerBall(state);
      return;
    }
    // 停顿结束，房主自动发球
    serve(state);
    return;
  }

  // 按位移切分子步，高速时也不会穿过球拍
  const speed = Math.hypot(state.ball.vx, state.ball.vy) || state.speed;
  const steps = clamp(Math.ceil((speed * dt) / 4), 1, 8);
  for (let i = 0; i < steps && state.phase === 'play'; i += 1) {
    stepBall(state, dt / steps);
  }
}

export function toSnapshot(state: PongState): PongSnapshot {
  return {
    ballX: state.ball.x,
    ballY: state.ball.y,
    p0x: state.p0x,
    p1x: state.p1x,
    score0: state.score0,
    score1: state.score1,
  };
}

/** 校验对方发来的快照，避免脏数据把渲染搞崩。 */
export function isSnapshot(value: unknown): value is PongSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (['ballX', 'ballY', 'p0x', 'p1x', 'score0', 'score1'] as const).every((key) => {
    const field = record[key];
    return typeof field === 'number' && Number.isFinite(field);
  });
}

export function viewFromSnapshot(snapshot: PongSnapshot): PongView {
  return { ...snapshot };
}

/** 向目标值收敛：ratio 为 1 表示立刻到位。 */
export function lerp(current: number, target: number, ratio: number): number {
  return current + (target - current) * clamp(ratio, 0, 1);
}

/**
 * 客户端每帧调用：球和两块球拍都朝最新快照插值。
 * 比分变化说明刚有人得分（球被放回中间），这时直接吸附，否则球会横穿整个球场。
 * 自己那一侧的球拍随后会被 `setViewPaddle` 覆盖成本地值。
 */
export function interpolateView(view: PongView, target: PongSnapshot, ratio: number): void {
  if (view.score0 !== target.score0 || view.score1 !== target.score1) {
    view.ballX = target.ballX;
    view.ballY = target.ballY;
  } else {
    view.ballX = lerp(view.ballX, target.ballX, ratio);
    view.ballY = lerp(view.ballY, target.ballY, ratio);
  }
  view.p0x = lerp(view.p0x, target.p0x, ratio);
  view.p1x = lerp(view.p1x, target.p1x, ratio);
  view.score0 = target.score0;
  view.score1 = target.score1;
}

/** 在渲染视图里写下本地球拍的位置（自己的球拍不等网络）。 */
export function setViewPaddle(view: PongView, seat: Seat, x: number): void {
  const px = clampPaddleX(x);
  if (seat === 0) view.p0x = px;
  else view.p1x = px;
}

/**
 * 客户端判断「球是不是停在中间等发球」：连续两次快照几乎没动就说明是。
 * 刚进场还没有上一帧时返回 false，宁可先按对打中显示。
 */
export function ballIdle(prev: PongSnapshot | null, next: PongSnapshot, eps = 0.5): boolean {
  if (!prev) return false;
  return Math.abs(next.ballX - prev.ballX) < eps && Math.abs(next.ballY - prev.ballY) < eps;
}

/** 客户端从快照推断局面（快照里没有 phase 字段，只能这样还原）。 */
export function phaseOf(snapshot: PongSnapshot, idle: boolean): PongPhase {
  if (snapshot.score0 >= WIN_SCORE || snapshot.score1 >= WIN_SCORE) return 'over';
  return idle ? 'serve' : 'play';
}
