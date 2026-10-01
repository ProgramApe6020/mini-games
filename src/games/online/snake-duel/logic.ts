/**
 * 贪吃蛇对战（Snake Duel）的纯逻辑：不依赖 React、不碰 DOM，方便单元测试。
 *
 * 网络模型是「房主权威」：
 *   - 房主每个 STEP_MS 调一次 advance()，把新的 DuelState 广播给客户端；
 *   - 客户端只把收到的 state 原样画出来，并把自己的转向用 input 消息发给房主。
 * 因此这里的函数必须是纯函数：同一份 state + 同一组输入，必须算出同一份结果，
 * 而且不能依赖「先结算哪条蛇」。
 *
 * advance() 刻意拆成四个阶段来保证这一点：
 *   1. 先算出两条蛇的新头位置（此时不动任何身体）；
 *   2. 再算出「这一步之后仍然被占用的格子」（不吃食物时尾巴会让出来）；
 *   3. 用同一份快照统一判定越界 / 撞自己 / 撞对方身体 / 两个新头撞在同一格；
 *   4. 最后才结算身体、分数、复活和食物。
 * 三个阶段的输入都只来自「这一步开始时」的 state，所以互换两条蛇的处理顺序结果完全一致。
 */

export type Vec = { x: number; y: number };
/** 座位：0 = 玩家 1（从左侧出发），1 = 玩家 2（从右侧出发）。 */
export type Seat = 0 | 1;
export type DirectionName = 'up' | 'down' | 'left' | 'right';
/** ready = 等待开始，running = 对局中，over = 已经分出胜负。 */
export type Phase = 'ready' | 'running' | 'over';
/** 随机数源（返回值应在 [0, 1)）。注入进来是为了让「食物重新生成」也能被测试。 */
export type Rng = () => number;

export const COLS = 26;
export const ROWS = 20;
export const CELL = 22;
/** 逻辑坐标 572 × 440，渲染时用 aspectRatio 等比缩放到容器宽度。 */
export const BOARD_W = COLS * CELL;
export const BOARD_H = ROWS * CELL;

/** 房主的推进节拍：每 140ms 走一格。 */
export const STEP_MS = 140;
/** 出局后等待复活的时间（约 1.2 秒）。 */
export const RESPAWN_MS = 1200;
/** 换算成步数：1200 / 140 ≈ 8.57，取整为 9 步（约 1.26 秒）。 */
export const RESPAWN_STEPS = Math.round(RESPAWN_MS / STEP_MS);
/** 先到 3 分者获胜。 */
export const WIN_SCORE = 3;
/** 出生时的身长（含头）。 */
export const START_LENGTH = 3;

export const SEATS: readonly Seat[] = [0, 1];

export const DIRECTIONS: Record<DirectionName, Vec> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

const DIRECTION_NAMES: readonly DirectionName[] = ['up', 'down', 'left', 'right'];

/** 出生行：场地正中间那一行。 */
export const SPAWN_ROW = Math.floor(ROWS / 2);
/** 两条蛇的头部出生列：3 和 22，关于 26 列的中线镜像。 */
export const SPAWN_HEAD_X: readonly [number, number] = [3, COLS - 4];

/** 一次对局的完整状态。房主是唯一权威来源，广播出去的就是这个对象（可直接 JSON 序列化）。 */
export type DuelState = {
  /** 两条蛇的完整坐标，[0] 是蛇头；出局（等待复活）时是空数组。 */
  snakes: [Vec[], Vec[]];
  /** 两条蛇当前的朝向，由房主确定。 */
  dirs: [Vec, Vec];
  food: Vec;
  /** 双方分数。 */
  scores: [number, number];
  /** 双方是否在场。 */
  alive: [boolean, boolean];
  /** 复活倒计时（还剩几步），0 表示不需要复活。 */
  respawn: [number, number];
  phase: Phase;
  /** 胜者座位；phase !== 'over' 时为 null。 */
  winner: Seat | null;
  /** 已经推进了多少步，方便调试与对账。 */
  tick: number;
};

export function cellKey(cell: Vec): string {
  return `${cell.x},${cell.y}`;
}

export function sameCell(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(cell: Vec): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < COLS && cell.y < ROWS;
}

export function isDirectionName(value: unknown): value is DirectionName {
  return typeof value === 'string' && (DIRECTION_NAMES as readonly string[]).includes(value);
}

/** 某个座位的出生蛇身：[0] 是头，其余各节朝出生的反方向排开。 */
export function spawnSnake(seat: Seat): Vec[] {
  const dirX = seat === 0 ? 1 : -1;
  const headX = SPAWN_HEAD_X[seat];
  const body: Vec[] = [];
  for (let i = 0; i < START_LENGTH; i += 1) {
    body.push({ x: headX - dirX * i, y: SPAWN_ROW });
  }
  return body;
}

/** 在空格子里随机挑一个放食物（两条蛇占的格子都算被占）。 */
export function spawnFood(snakes: readonly (readonly Vec[])[], rng: Rng = Math.random): Vec {
  const taken = new Set<string>();
  for (const body of snakes) {
    for (const seg of body) taken.add(cellKey(seg));
  }

  const free: Vec[] = [];
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if (!taken.has(`${x},${y}`)) free.push({ x, y });
    }
  }

  // 极端情况：整个场地被两条蛇占满（实际上到不了），退化成 (0,0)。
  if (free.length === 0) return { x: 0, y: 0 };

  const index = Math.min(free.length - 1, Math.max(0, Math.floor(rng() * free.length)));
  return free[index]!;
}

/** 新的一局：两条蛇在左右两侧就位，phase 是 ready（等房主调 startDuel）。 */
export function createDuelState(rng: Rng = Math.random): DuelState {
  const snakes: [Vec[], Vec[]] = [spawnSnake(0), spawnSnake(1)];
  return {
    snakes,
    dirs: [{ ...DIRECTIONS.right }, { ...DIRECTIONS.left }],
    food: spawnFood(snakes, rng),
    scores: [0, 0],
    alive: [true, true],
    respawn: [0, 0],
    phase: 'ready',
    winner: null,
    tick: 0,
  };
}

/** 开始对局（房主在两人到齐后调用）。 */
export function startDuel(state: DuelState): DuelState {
  if (state.phase !== 'ready') return state;
  return { ...state, phase: 'running' };
}

/** 这一步能不能接受某个转向：出局/结束后不行，方向没变不行，180° 掉头也不行。 */
export function canTurn(state: DuelState, seat: Seat, name: DirectionName): boolean {
  if (state.phase === 'over') return false;
  if (!state.alive[seat]) return false;

  const dir = DIRECTIONS[name];
  const current = state.dirs[seat];
  if (dir.x === current.x && dir.y === current.y) return false;
  if (dir.x + current.x === 0 && dir.y + current.y === 0) return false;
  return true;
}

/**
 * 应用一个转向。
 * 方向没变（或不允许）时原样返回同一个引用，调用方据此判断「不必发包」。
 */
export function applyDirection(state: DuelState, seat: Seat, name: DirectionName): DuelState {
  if (!canTurn(state, seat, name)) return state;

  const dirs: [Vec, Vec] = [{ ...state.dirs[0] }, { ...state.dirs[1] }];
  dirs[seat] = { ...DIRECTIONS[name] };
  return { ...state, dirs };
}

/** 同一拍里把两条蛇的转向都应用上，顺序无关（每个座位只改自己的朝向）。 */
export function stepWithInputs(
  state: DuelState,
  inputs: readonly [DirectionName | null, DirectionName | null],
  rng: Rng = Math.random,
): DuelState {
  let next = state;
  for (const seat of SEATS) {
    const name = inputs[seat];
    if (name) next = applyDirection(next, seat, name);
  }
  return advance(next, rng);
}

/**
 * 推进一格。只有 phase === 'running' 时才真的动，否则原样返回（房主可以放心地空转）。
 *
 * 判定规则：
 *   - 撞墙 / 撞自己 / 撞到对方身体 → 该玩家出局：清空蛇身、扣 1 分（最低 0）、等待复活；
 *   - 两个新头撞在同一格 → 两人都出局（同一步里谁都吃不到那颗食物）；
 *   - 吃到食物 → +1 分并变长一节，食物在所有空格里重新随机生成；
 *   - 分数先到 WIN_SCORE 的玩家获胜，整局立刻结束。
 */
export function advance(state: DuelState, rng: Rng = Math.random): DuelState {
  if (state.phase !== 'running') return state;

  // ---- 阶段 1：两条蛇的新头位置（此时不改动任何身体） ----
  const heads: [Vec | null, Vec | null] = [null, null];
  const eating: [boolean, boolean] = [false, false];

  for (const seat of SEATS) {
    if (!state.alive[seat]) continue;
    const head = state.snakes[seat][0];
    if (!head) continue;
    const dir = state.dirs[seat];
    const next = { x: head.x + dir.x, y: head.y + dir.y };
    heads[seat] = next;
    eating[seat] = sameCell(next, state.food);
  }

  // ---- 阶段 2：每条蛇「这一步结束后仍然占着」的格子 ----
  // 不吃食物时尾巴会让出来，所以尾格可以安全进入；吃食物时尾巴不动，整条身体都算墙。
  const blocking: [Set<string>, Set<string>] = [new Set<string>(), new Set<string>()];
  for (const seat of SEATS) {
    const body = state.snakes[seat];
    if (!state.alive[seat]) continue;
    const keep = eating[seat] ? body.length : body.length - 1;
    for (let i = 0; i < keep; i += 1) blocking[seat].add(cellKey(body[i]!));
  }

  // ---- 阶段 3：统一判定（只看阶段 1/2 的结果，与处理顺序无关） ----
  const dead: [boolean, boolean] = [false, false];
  for (const seat of SEATS) {
    const head = heads[seat];
    if (!head) continue;
    const other = (seat === 0 ? 1 : 0) as Seat;

    if (!inBounds(head)) {
      dead[seat] = true;
    } else if (blocking[seat].has(cellKey(head))) {
      dead[seat] = true;
    } else if (blocking[other].has(cellKey(head))) {
      dead[seat] = true;
    } else {
      const otherHead = heads[other];
      if (otherHead && sameCell(head, otherHead)) dead[seat] = true;
    }
  }

  // ---- 阶段 4：结算 ----
  const snakes: [Vec[], Vec[]] = [[], []];
  const alive: [boolean, boolean] = [false, false];
  const respawn: [number, number] = [0, 0];
  const scores: [number, number] = [state.scores[0], state.scores[1]];
  const died: [boolean, boolean] = [false, false];
  let foodEaten = false;

  for (const seat of SEATS) {
    const head = heads[seat];

    if (head && !dead[seat]) {
      // 活着：把头接上去，没吃到食物就把尾巴缩掉一节
      const body = state.snakes[seat];
      snakes[seat] = eating[seat] ? [head, ...body] : [head, ...body.slice(0, -1)];
      alive[seat] = true;
      if (eating[seat]) {
        scores[seat] += 1;
        foodEaten = true;
      }
      continue;
    }

    if (head) {
      // 这一步刚出局：清空身体、扣 1 分（最低 0）、开始复活倒计时
      died[seat] = true;
      scores[seat] = Math.max(0, scores[seat] - 1);
      respawn[seat] = RESPAWN_STEPS;
      continue;
    }

    // 本来就在等待复活：倒计时减一
    respawn[seat] = Math.max(0, state.respawn[seat] - 1);
  }

  // 倒计时归零就复活；出生点被对手占着就再等一步（避免两条蛇重叠）。
  for (const seat of SEATS) {
    if (alive[seat] || died[seat] || respawn[seat] > 0) continue;

    const body = spawnSnake(seat);
    const taken = new Set<string>();
    for (const other of SEATS) {
      for (const seg of snakes[other]) taken.add(cellKey(seg));
    }
    if (body.some((seg) => taken.has(cellKey(seg)))) continue;

    snakes[seat] = body;
    alive[seat] = true;
  }

  // 只有活下来的蛇吃到食物才算数（两个头撞在同一格时谁都吃不到）。
  const food = foodEaten ? spawnFood(snakes, rng) : state.food;

  // 先到 3 分者获胜。只有一颗食物，理论上不可能同一步双方都到 3 分；
  // 万一出现就按座位 0 优先，保证结果唯一。
  let winner: Seat | null = null;
  if (scores[0] >= WIN_SCORE || scores[1] >= WIN_SCORE) {
    winner = scores[0] >= WIN_SCORE ? 0 : 1;
  }

  return {
    snakes,
    dirs: [{ ...state.dirs[0] }, { ...state.dirs[1] }],
    food,
    scores,
    alive,
    respawn,
    phase: winner === null ? 'running' : 'over',
    winner,
    tick: state.tick + 1,
  };
}

function isVec(value: unknown): value is Vec {
  if (typeof value !== 'object' || value === null) return false;
  const vec = value as { x?: unknown; y?: unknown };
  return typeof vec.x === 'number' && Number.isFinite(vec.x) && typeof vec.y === 'number' && Number.isFinite(vec.y);
}

function isVecList(value: unknown): value is Vec[] {
  return Array.isArray(value) && value.every(isVec);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isSeat(value: unknown): value is Seat {
  return value === 0 || value === 1;
}

function isPair<T>(value: unknown, check: (item: unknown) => item is T): value is [T, T] {
  return Array.isArray(value) && value.length === 2 && check(value[0]) && check(value[1]);
}

function isPhase(value: unknown): value is Phase {
  return value === 'ready' || value === 'running' || value === 'over';
}

/**
 * 校验从网络上收到的 state（JSON 反序列化后 tuple 会变成普通数组，所以只能按数组检查）。
 * 客户端收到不合法的东西时直接丢弃，避免整块场地被画崩。
 */
export function isDuelState(value: unknown): value is DuelState {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Partial<DuelState>;

  if (!isPair(state.snakes, isVecList)) return false;
  if (!isPair(state.dirs, isVec)) return false;
  if (!isVec(state.food)) return false;
  if (!isPair(state.scores, isFiniteNumber)) return false;
  if (!isPair(state.alive, isBoolean)) return false;
  if (!isPair(state.respawn, isFiniteNumber)) return false;
  if (!isPhase(state.phase)) return false;
  if (state.winner !== null && !isSeat(state.winner)) return false;
  if (!isFiniteNumber(state.tick)) return false;
  return true;
}
