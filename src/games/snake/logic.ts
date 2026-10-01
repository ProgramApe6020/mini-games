/**
 * 贪吃蛇的纯逻辑（不依赖 React，方便单元测试）。
 * 状态放在一个普通对象里并被原地修改，渲染层每帧读取它。
 */

export const COLS = 20;
export const ROWS = 20;
export const CELL = 24;
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

export const START_STEP_MS = 140;
export const MIN_STEP_MS = 65;
export const FOOD_SCORE = 10;

export type Vec = { x: number; y: number };
export type Phase = 'ready' | 'running' | 'paused' | 'over';
export type DirectionName = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: Record<DirectionName, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export type SnakeState = {
  /** 蛇身，[0] 是头 */
  snake: Vec[];
  dir: Vec;
  /** 待执行的方向（缓冲，避免快速连按导致误判掉头） */
  queued: Vec[];
  food: Vec;
  score: number;
  /** 每一步的间隔毫秒数，随分数变小（越来越快） */
  stepMs: number;
  /** 累积的时间，够了就走一步 */
  acc: number;
  /** 还需要增长的格数 */
  grow: number;
  phase: Phase;
};

export function spawnFood(snake: Vec[]): Vec {
  const taken = new Set(snake.map((seg) => `${seg.x},${seg.y}`));
  const free: Vec[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (free.length === 0) {
    // 蛇占满整个棋盘（实际上到不了），退回头部位置避免报错
    return { ...snake[0]! };
  }
  return free[Math.floor(Math.random() * free.length)]!;
}

export function createState(): SnakeState {
  const y = Math.floor(ROWS / 2);
  const snake: Vec[] = [
    { x: 6, y },
    { x: 5, y },
    { x: 4, y },
  ];
  return {
    snake,
    dir: { ...DIRECTIONS.right },
    queued: [],
    food: spawnFood(snake),
    score: 0,
    stepMs: START_STEP_MS,
    acc: 0,
    grow: 0,
    phase: 'ready',
  };
}

/** 记录一个转向指令。不能 180° 掉头，也不能与上一个指令重复。 */
export function queueDirection(state: SnakeState, name: DirectionName): boolean {
  if (state.phase === 'over') return false;

  const dir = DIRECTIONS[name];
  const last = state.queued.length > 0 ? state.queued[state.queued.length - 1]! : state.dir;

  if (last.x === dir.x && last.y === dir.y) return false;
  if (last.x + dir.x === 0 && last.y + dir.y === 0) return false;
  if (state.queued.length >= 2) return false;

  state.queued.push({ ...dir });
  if (state.phase === 'ready') state.phase = 'running';
  return true;
}

/** 走一步。撞墙或咬到自己则把 phase 置为 'over'。 */
export function advance(state: SnakeState): void {
  if (state.phase !== 'running') return;

  const buffered = state.queued.shift();
  if (buffered) state.dir = buffered;

  const head = state.snake[0]!;
  const target: Vec = { x: head.x + state.dir.x, y: head.y + state.dir.y };

  if (target.x < 0 || target.y < 0 || target.x >= COLS || target.y >= ROWS) {
    state.phase = 'over';
    return;
  }

  // 不吃食物时尾巴会缩掉一格，因此最后一节可以安全进入
  const bodyLimit = state.grow > 0 ? state.snake.length : state.snake.length - 1;
  for (let i = 0; i < bodyLimit; i += 1) {
    const seg = state.snake[i]!;
    if (seg.x === target.x && seg.y === target.y) {
      state.phase = 'over';
      return;
    }
  }

  state.snake.unshift(target);

  if (target.x === state.food.x && target.y === state.food.y) {
    state.score += FOOD_SCORE;
    state.grow += 1;
    state.stepMs = Math.max(MIN_STEP_MS, START_STEP_MS - Math.floor(state.score / 50) * 8);
    state.food = spawnFood(state.snake);
  }

  if (state.grow > 0) {
    state.grow -= 1;
  } else {
    state.snake.pop();
  }
}

/** 暂停 / 继续 / 开始，返回切换后的阶段。 */
export function togglePause(state: SnakeState): Phase {
  if (state.phase === 'ready') state.phase = 'running';
  else if (state.phase === 'running') state.phase = 'paused';
  else if (state.phase === 'paused') state.phase = 'running';
  return state.phase;
}
