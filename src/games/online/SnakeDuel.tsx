import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { roundRect, setupCanvas } from '../../lib/canvas';
import { useDuel, useRoomParams } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import {
  BOARD_H,
  BOARD_W,
  CELL,
  COLS,
  ROWS,
  STEP_MS,
  advance,
  applyDirection,
  createDuelState,
  isDirectionName,
  isDuelState,
  spawnSnake,
  startDuel,
  type DirectionName,
  type DuelState,
  type Seat,
  type Vec,
} from './snake-duel/logic';
import './snake-duel.css';

const game = getGame('snake-duel')!;

const KEY_TO_DIRECTION: Record<string, DirectionName> = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
};

/** 两条蛇的配色：玩家 1 绿色，玩家 2 蓝色。 */
type Skin = { head: string; glow: string; hue: number; sat: number };

const SKINS: [Skin, Skin] = [
  { head: '#86efac', glow: 'rgba(74,222,128,.55)', hue: 146, sat: 62 },
  { head: '#93c5fd', glow: 'rgba(96,165,250,.55)', hue: 214, sat: 68 },
];

function bodyColor(skin: Skin, t: number): string {
  return `hsl(${skin.hue + t * 18} ${skin.sat}% ${56 - t * 16}%)`;
}

/** 画一条蛇：头亮、身体向尾部逐渐变暗，尾巴加一圈白环表示「这是你」。 */
function drawSnake(
  ctx: CanvasRenderingContext2D,
  body: Vec[],
  dir: Vec,
  skin: Skin,
  isSelf: boolean,
): void {
  const total = Math.max(body.length - 1, 1);

  body.forEach((seg, index) => {
    const t = index / total;
    const pad = index === 0 ? 1.5 : 2.6;
    ctx.save();
    if (index === 0) {
      ctx.shadowColor = skin.glow;
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = index === 0 ? skin.head : bodyColor(skin, t);
    roundRect(ctx, seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 7);
    ctx.fill();
    ctx.restore();
  });

  const head = body[0]!;
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;

  // 眼睛：跟着当前朝向转
  const spread = 4.2;
  const forward = 3;
  const eyes = [
    {
      x: cx + dir.x * forward + (dir.x === 0 ? spread : 0),
      y: cy + dir.y * forward + (dir.y === 0 ? spread : 0),
    },
    {
      x: cx + dir.x * forward - (dir.x === 0 ? spread : 0),
      y: cy + dir.y * forward - (dir.y === 0 ? spread : 0),
    },
  ];
  ctx.fillStyle = '#08111f';
  for (const eye of eyes) {
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  if (isSelf) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, CELL / 2 - 1.6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

/** 出局时在出生点画一圈虚线，并标出还有多久复活。 */
function drawGhost(
  ctx: CanvasRenderingContext2D,
  seat: Seat,
  skin: Skin,
  state: DuelState,
  isSelf: boolean,
): void {
  const body = spawnSnake(seat);
  const head = body[0]!;

  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = skin.head;
  for (const seg of body) {
    roundRect(ctx, seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4, 6);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 0.92;
  ctx.fillStyle = skin.head;
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const seconds = Math.max(1, Math.round((state.respawn[seat] * STEP_MS) / 1000));
  ctx.fillText(
    `${isSelf ? '你 ' : ''}${seconds}s`,
    head.x * CELL + CELL / 2,
    head.y * CELL + CELL / 2,
  );
  ctx.restore();
}

/** 把一份 state 完整画出来。房主和客户端用的是同一个函数。 */
function drawDuel(
  ctx: CanvasRenderingContext2D,
  state: DuelState,
  time: number,
  viewSeat: Seat,
): void {
  ctx.fillStyle = '#0a1020';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // 淡淡的棋盘格，方便判断格子位置
  for (let y = 0; y < ROWS; y += 1) {
    for (let x = 0; x < COLS; x += 1) {
      if ((x + y) % 2 === 0) {
        ctx.fillStyle = 'rgba(255,255,255,.022)';
        ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      }
    }
  }

  // 食物：会呼吸的光点
  const fx = state.food.x * CELL + CELL / 2;
  const fy = state.food.y * CELL + CELL / 2;
  const pulse = 1 + Math.sin(time / 230) * 0.09;
  const glow = ctx.createRadialGradient(fx, fy, 1, fx, fy, (CELL / 2) * pulse);
  glow.addColorStop(0, '#fecaca');
  glow.addColorStop(1, '#ef4444');
  ctx.save();
  ctx.shadowColor = 'rgba(239,68,68,.75)';
  ctx.shadowBlur = 14;
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(fx, fy, (CELL / 2 - 3.5) * pulse, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  for (const seat of [0, 1] as const) {
    const body = state.snakes[seat];
    if (!state.alive[seat] || body.length === 0) {
      drawGhost(ctx, seat, SKINS[seat], state, seat === viewSeat);
      continue;
    }
    drawSnake(ctx, body, state.dirs[seat], SKINS[seat], seat === viewSeat);
  }
}

/**
 * 画布本身。单独做成一个子组件，这样它只在「对局中」挂载，
 * 挂载时的 effect 一定能拿到 canvas（否则先进大厅、后进房间会导致画布永远不初始化）。
 */
function DuelBoard({ stateRef, seat }: { stateRef: RefObject<DuelState>; seat: Seat }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = setupCanvas(canvas, BOARD_W, BOARD_H);
    if (!ctx) return undefined;

    let raf = 0;
    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);
      drawDuel(ctx, stateRef.current, now, seat);
    };

    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [stateRef, seat]);

  return (
    <canvas
      ref={canvasRef}
      className="snake-duel-canvas"
      style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
    />
  );
}

/**
 * 贪吃蛇对战——实时联机，房主权威。
 *
 * 协议（BroadcastChannel / Supabase Realtime，都走 useDuel）：
 *   state         房主 -> 客户端：一步的完整快照（两条蛇的坐标、食物、分数、存活、阶段）
 *   input         客户端 -> 房主：{ dir }，座位 1 的转向请求；方向没变就不发
 *   sync-request  客户端 -> 房主：我刚进来/刷新了，请把当前场地发我（没收全就每 800ms 重发）
 *   restart       任一方 -> 房主：再来一局，房主开新局并广播
 *
 * 房主每 140ms 调一次 advance() 推进整局并广播；客户端不做任何模拟，只把收到的
 * state 画出来（本来就是跳格推进，不需要插值），键盘输入在本地乐观生效。
 */
export default function SnakeDuel() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);
  const opponentSeat: Seat = seat === 0 ? 1 : 0;

  const [state, setState] = useState<DuelState>(() => createDuelState());
  const [started, setStarted] = useState(false);
  const stateRef = useRef(state);

  const commit = useCallback((next: DuelState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const duel = useDuel({
    gameId: 'snake-duel',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'sync-request') {
        if (seat === 0) api.send('state', stateRef.current);
        return;
      }

      if (message.type === 'state') {
        if (seat === 0) return; // 房主只信自己算出来的状态
        if (!isDuelState(message.data)) return;
        commit(message.data);
        setStarted(true);
        return;
      }

      if (message.type === 'input') {
        if (seat !== 0) return; // 转向请求只由房主裁决
        const data = message.data as { dir?: unknown } | undefined;
        if (!isDirectionName(data?.dir)) return;
        const next = applyDirection(stateRef.current, opponentSeat, data.dir);
        if (next !== stateRef.current) commit(next); // 下一次广播会带上这个转向
        return;
      }

      if (message.type === 'restart') {
        if (seat !== 0) return;
        const fresh = startDuel(createDuelState());
        commit(fresh);
        api.send('state', fresh);
      }
    },
  });

  const { send, isHost, status } = duel;

  // 两人到齐：房主开一局新的，并立刻把场地推给客户端
  useEffect(() => {
    if (status !== 'ready' || !isHost) return;
    const fresh = startDuel(createDuelState());
    commit(fresh);
    setStarted(true);
    send('state', fresh);
  }, [status, isHost, send, commit]);

  // 客户端进场 / 刷新后主动要状态，收到第一份为止
  useEffect(() => {
    if (status !== 'ready' || isHost || started) return undefined;
    const timer = window.setInterval(() => send('sync-request'), 800);
    return () => window.clearInterval(timer);
  }, [status, isHost, started, send]);

  // 房主的固定节拍：每 140ms 推进一格并广播
  useEffect(() => {
    if (status !== 'ready' || !isHost) return undefined;
    const timer = window.setInterval(() => {
      if (stateRef.current.phase !== 'running') return; // 还没开始或已经结束，不发无用包
      const next = advance(stateRef.current);
      commit(next);
      send('state', next);
    }, STEP_MS);
    return () => window.clearInterval(timer);
  }, [status, isHost, send, commit]);

  const turn = useCallback(
    (name: DirectionName) => {
      const next = applyDirection(stateRef.current, seat, name);
      if (next === stateRef.current) return; // 方向没变或不允许掉头：不发包
      commit(next); // 本地乐观生效，最终判定在房主
      if (!isHost) send('input', { dir: name });
    },
    [seat, isHost, send, commit],
  );

  // 键盘：方向键 / WASD
  useEffect(() => {
    if (status !== 'ready' || !started) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      const name = KEY_TO_DIRECTION[event.key.toLowerCase()];
      if (!name) return;
      event.preventDefault();
      turn(name);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [status, started, turn]);

  // 画布由子组件 DuelBoard 负责，它只在「对局中」挂载

  const restart = useCallback(() => {
    if (isHost) {
      const fresh = startDuel(createDuelState());
      commit(fresh);
      send('state', fresh);
      return;
    }
    send('restart');
  }, [isHost, commit, send]);

  const statusText =
    status !== 'ready'
      ? '对手已离开，等待重新连接…'
      : !started
        ? isHost
          ? '正在准备场地…'
          : '等待对手…'
        : state.phase === 'ready'
          ? '准备开始，先到 3 分者胜'
          : state.phase === 'over'
            ? state.winner === seat
              ? '你先到 3 分赢了 🎉'
              : '对手赢了'
            : !state.alive[seat]
              ? '你出局了，马上在出生点复活…'
              : !state.alive[opponentSeat]
                ? '对手出局了，快抢果实！'
                : '轮到你操作，抢果实先到 3 分';

  return (
    <GameFrame
      game={game}
      score={null}
      best={null}
      hideScores
      hint={game.controls}
      extra={<NetBadge duel={duel} />}
    >
      {!duel.room ? (
        <LobbyScreen game={game} />
      ) : status !== 'ready' ? (
        <WaitingScreen duel={duel} />
      ) : (
        <>
          <DuelStatusBar duel={duel} scores={state.scores} unit="分" />

          <div className="snake-duel-wrap">
            <DuelBoard stateRef={stateRef} seat={seat} />
            {state.phase === 'over' ? (
              <div className="overlay">
                <h2>{state.winner === seat ? '你先到 3 分赢了 🎉' : '对手赢了'}</h2>
                <p>
                  最终比分 {state.scores[seat]} : {state.scores[opponentSeat]}
                </p>
                <button type="button" className="btn btn-primary" onClick={restart}>
                  再来一局
                </button>
              </div>
            ) : null}
          </div>

          <div className="snake-duel-legend">
            {([0, 1] as const).map((chipSeat) => (
              <span
                key={chipSeat}
                className={`snake-duel-chip is-p${chipSeat + 1}${
                  chipSeat === seat ? ' is-self' : ''
                }${state.alive[chipSeat] ? '' : ' is-out'}`}
              >
                <i className="snake-duel-dot" />
                {chipSeat === 0 ? '玩家 1' : '玩家 2'}
                {chipSeat === seat ? '（你）' : ''}
                <b>{state.scores[chipSeat]}</b>
                <em>{state.alive[chipSeat] ? '在场' : '复活中'}</em>
              </span>
            ))}
          </div>

          <p className="duel-status">{statusText}</p>
        </>
      )}
    </GameFrame>
  );
}
