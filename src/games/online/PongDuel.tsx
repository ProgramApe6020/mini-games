import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { roundRect, setupCanvas } from '../../lib/canvas';
import { useDuel, useRoomParams, type Seat } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import {
  BALL_R,
  H,
  INTERP_RATE,
  PADDLE_H,
  PADDLE_KEY_SPEED,
  PADDLE_W,
  PADDLE_Y0,
  PADDLE_Y1,
  SERVE_DELAY,
  W,
  WIN_SCORE,
  ballIdle,
  clampPaddleX,
  createState,
  interpolateView,
  isSnapshot,
  movePaddle,
  phaseOf,
  requestServe,
  resetMatch,
  setViewPaddle,
  toSnapshot,
  update,
  viewFromSnapshot,
  type PongPhase,
  type PongSnapshot,
  type PongState,
  type PongView,
} from './pong/logic';
import './pong.css';

const game = getGame('pong')!;

/**
 * 房主广播快照的间隔（秒）。40ms ≈ 25 次/秒：
 * 客户端再插值一下就很顺，带宽也不会失控。
 */
const STATE_INTERVAL = 0.04;
/** 客户端上传球拍位置的间隔（秒）：约 30 次/秒，值没变就不发。 */
const INPUT_INTERVAL = 1 / 30;

const HINT = '左右拖动鼠标 / 触屏移动球拍 · ← → 或 A D · 空格立即发球 · 先到 7 分获胜';

const P0_COLOR = '#22d3ee';
const P1_COLOR = '#f472b6';

function drawPaddle(ctx: CanvasRenderingContext2D, cx: number, top: number, color: string): void {
  const x = cx - PADDLE_W / 2;
  const gradient = ctx.createLinearGradient(x, top, x + PADDLE_W, top + PADDLE_H);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.5, '#f8fafc');
  gradient.addColorStop(1, color);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 16;
  ctx.fillStyle = gradient;
  roundRect(ctx, x, top, PADDLE_W, PADDLE_H, PADDLE_H / 2);
  ctx.fill();
  ctx.restore();
}

/** 画一帧。房主传自己的权威快照，客户端传插值后的视图。 */
function draw(ctx: CanvasRenderingContext2D, view: PongSnapshot, seat: Seat): void {
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, '#0b1526');
  background.addColorStop(0.5, '#070d1a');
  background.addColorStop(1, '#0b1526');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  // 中线（球网）
  ctx.save();
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = 'rgba(148,163,184,.32)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(6, H / 2);
  ctx.lineTo(W - 6, H / 2);
  ctx.stroke();
  ctx.restore();

  // 大比分：上半场是座位 1，下半场是座位 0
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 84px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = 'rgba(148,163,184,.16)';
  ctx.fillText(String(view.score1), W / 2, H / 2 - 72);
  ctx.fillText(String(view.score0), W / 2, H / 2 + 72);
  ctx.restore();

  drawPaddle(ctx, view.p1x, PADDLE_Y1, P1_COLOR);
  drawPaddle(ctx, view.p0x, PADDLE_Y0, P0_COLOR);

  // 球
  const ball = ctx.createRadialGradient(view.ballX - 2, view.ballY - 2, 1, view.ballX, view.ballY, BALL_R);
  ball.addColorStop(0, '#ffffff');
  ball.addColorStop(1, '#a5f3fc');
  ctx.save();
  ctx.shadowColor = 'rgba(226,232,240,.9)';
  ctx.shadowBlur = 18;
  ctx.fillStyle = ball;
  ctx.beginPath();
  ctx.arc(view.ballX, view.ballY, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 标明哪一边是自己
  ctx.save();
  ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = P1_COLOR;
  ctx.fillText(seat === 1 ? '玩家 2（你）' : '玩家 2', 10, PADDLE_Y1 + PADDLE_H + 10);
  ctx.fillStyle = P0_COLOR;
  ctx.fillText(seat === 0 ? '玩家 1（你）' : '玩家 1', 10, PADDLE_Y0 - 24);
  ctx.restore();
}

/**
 * 乒乓球联机对战。这是整个合集里唯一一个**实时**对局，所以网络模型是「房主权威」：
 *
 *  - 房主（座位 0）用 rAF 跑完整物理（单帧上限 0.05s），每约 40ms 广播一次
 *    `state` 快照 `{ ballX, ballY, p0x, p1x, score0, score1 }`；
 *  - 客户端（座位 1）立刻本地移动自己的球拍，并用 `input` 把球拍中心 x
 *    节流到约 30 次/秒发给房主（值没变就不发）；
 *  - 客户端渲染时，自己的球拍用本地值，球和对手球拍向最新快照插值
 *    （每帧约 25%，按 dt 折算），否则会一顿一顿；
 *  - `serve` / `restart` 都是「谁按谁发消息，房主执行」；客户端进场发 `sync-request`。
 *
 * 对手掉线（`duel.status !== 'ready'`）时房主停止推进物理并把画面换成等待页。
 */
export default function PongDuel() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);
  const isHost = seat === 0;

  const [initial] = useState<PongState>(() => createState());
  /** 房主的权威状态；客户端不使用它推进物理。 */
  const stateRef = useRef<PongState>(initial);
  /** 客户端插值渲染用的视图（房主不用）。 */
  const viewRef = useRef<PongView>(viewFromSnapshot(toSnapshot(initial)));
  /** 最近一次收到的快照（客户端）。 */
  const snapRef = useRef<PongSnapshot | null>(null);
  /** 本地球拍中心 x：指针 / 键盘写它，立即生效，不等网络。 */
  const localXRef = useRef(W / 2);
  /** 上一次发给房主的位置，用来去重。 */
  const sentXRef = useRef(-1);
  const keysRef = useRef({ left: false, right: false });
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const [phase, setPhase] = useState<PongPhase>(initial.phase);
  const [scores, setScores] = useState<[number, number]>([0, 0]);
  const [serveIn, setServeIn] = useState(SERVE_DELAY);
  const [started, setStarted] = useState(false);

  // 游戏状态 → React 状态：值没变就不触发重渲染（和 Breakout 的做法一致）
  const lastUiRef = useRef({ phase: initial.phase, score0: -1, score1: -1, pause: -1 });
  const syncUi = useCallback((nextPhase: PongPhase, score0: number, score1: number, pause: number) => {
    const rounded = Math.max(0, Math.round(pause * 10) / 10);
    const last = lastUiRef.current;
    if (last.phase === nextPhase && last.score0 === score0 && last.score1 === score1 && last.pause === rounded) {
      return;
    }
    lastUiRef.current = { phase: nextPhase, score0, score1, pause: rounded };
    setPhase(nextPhase);
    setScores((prev) => (prev[0] === score0 && prev[1] === score1 ? prev : [score0, score1]));
    setServeIn(rounded);
  }, []);

  /** 复位一局（房主执行；客户端等房主广播新快照）。 */
  const resetLocal = useCallback(() => {
    resetMatch(stateRef.current);
    const snapshot = toSnapshot(stateRef.current);
    snapRef.current = snapshot;
    viewRef.current = viewFromSnapshot(snapshot);
    sentXRef.current = -1;
    syncUi(stateRef.current.phase, 0, 0, SERVE_DELAY);
  }, [syncUi]);

  const duel = useDuel({
    gameId: 'pong',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'input') {
        // 只有房主消费客户端上报的球拍位置，而且只认座位 1 自报的身份
        if (seat !== 0 || message.seat !== 1) return;
        const data = message.data as { x?: unknown } | undefined;
        if (!data || typeof data.x !== 'number' || !Number.isFinite(data.x)) return;
        movePaddle(stateRef.current, 1, data.x);
        return;
      }

      if (message.type === 'serve') {
        if (seat === 0) requestServe(stateRef.current);
        return;
      }

      if (message.type === 'restart') {
        if (seat === 0) resetLocal();
        return;
      }

      if (message.type === 'sync-request') {
        if (seat === 0) api.send('state', toSnapshot(stateRef.current));
        return;
      }

      if (message.type === 'state') {
        if (seat === 0) return; // 房主自己就是权威
        const data = message.data;
        if (!isSnapshot(data)) return;
        // 刚进场先吸附一次，避免球从中间慢慢滑过去
        if (snapRef.current === null) viewRef.current = viewFromSnapshot(data);
        const idle = ballIdle(snapRef.current, data);
        snapRef.current = data;
        setStarted(true);
        syncUi(phaseOf(data, idle), data.score0, data.score1, 0);
      }
    },
  });

  const { send, status } = duel;

  /** 再来一局：房主直接复位，客户端请房主复位。 */
  const rematch = useCallback(() => {
    if (isHost) resetLocal();
    else send('restart');
  }, [isHost, resetLocal, send]);

  // 对手到齐：房主马上同步一次快照，客户端上报球拍位置并主动要一次状态
  useEffect(() => {
    if (status !== 'ready') return undefined;
    setStarted(true);

    if (isHost) {
      send('state', toSnapshot(stateRef.current));
      return undefined;
    }

    sentXRef.current = localXRef.current;
    send('input', { x: localXRef.current });
    const timer = window.setTimeout(() => send('sync-request'), 400);
    return () => window.clearTimeout(timer);
  }, [status, isHost, send]);

  // 键盘：← → / A D 移动球拍，空格请求发球（结束后是再来一局）
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') {
        event.preventDefault();
        keysRef.current.left = true;
        return;
      }
      if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        keysRef.current.right = true;
        return;
      }
      if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        if (status !== 'ready') return;
        if (phase === 'over') {
          rematch();
          return;
        }
        if (isHost) requestServe(stateRef.current);
        else send('serve');
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') keysRef.current.left = false;
      if (key === 'arrowright' || key === 'd') keysRef.current.right = false;
    };

    // 切走标签页时键盘不会再发 keyup，这里兜底，避免球拍一直往一边跑
    const onBlur = () => {
      keysRef.current.left = false;
      keysRef.current.right = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [status, isHost, send, phase, rematch]);

  // 主循环：房主跑权威物理并广播，客户端插值渲染并上报球拍
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = setupCanvas(canvas, W, H);
    if (!ctx) return undefined;

    let raf = 0;
    let last = performance.now();
    let sinceSync = 0;
    let sinceInput = 0;

    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);

      // 限制单帧步长：切到后台再回来时不会一帧穿场
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const keys = keysRef.current;
      const dir = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
      if (dir !== 0) localXRef.current = clampPaddleX(localXRef.current + dir * PADDLE_KEY_SPEED * dt);

      const ready = status === 'ready';

      if (isHost) {
        const state = stateRef.current;
        movePaddle(state, 0, localXRef.current);
        if (ready) update(state, dt);

        const snapshot = toSnapshot(state);
        syncUi(state.phase, state.score0, state.score1, state.pause);

        if (ready) {
          sinceSync += dt;
          if (sinceSync >= STATE_INTERVAL) {
            sinceSync = 0;
            send('state', snapshot);
          }
        }

        draw(ctx, snapshot, seat);
        return;
      }

      const view = viewRef.current;
      const snap = snapRef.current;
      if (snap) interpolateView(view, snap, Math.min(1, dt * INTERP_RATE));
      setViewPaddle(view, seat, localXRef.current);
      draw(ctx, view, seat);

      sinceInput += dt;
      if (ready && sinceInput >= INPUT_INTERVAL) {
        sinceInput = 0;
        if (localXRef.current !== sentXRef.current) {
          sentXRef.current = localXRef.current;
          send('input', { x: localXRef.current });
        }
      }
    };

    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [status, isHost, seat, send, syncUi]);

  /** 把指针坐标换算回逻辑坐标（画布按 CSS 宽度等比缩放）。 */
  const pointAt = (clientX: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    localXRef.current = clampPaddleX(((clientX - rect.left) / rect.width) * W);
  };

  const winner: Seat = scores[0] >= WIN_SCORE ? 0 : 1;
  const iWon = winner === seat;
  const pausedByOpponent = status !== 'ready' && started;

  const statusText = !started
    ? '正在同步对局…'
    : phase === 'over'
      ? iWon
        ? '这一局你赢了 🎉'
        : '对手拿下了这一局'
      : phase === 'serve'
        ? isHost && serveIn > 0
          ? `准备发球… ${serveIn.toFixed(1)} 秒后自动发球（空格立刻发球）`
          : '准备发球… 按空格立刻发球'
        : '对打中 · 别让球从自己这一侧溜出去';

  return (
    <GameFrame
      game={game}
      score={null}
      best={null}
      hideScores
      hint={HINT}
      extra={<NetBadge duel={duel} />}
    >
      {!duel.room ? (
        <LobbyScreen game={game} />
      ) : status !== 'ready' ? (
        <WaitingScreen
          duel={duel}
          message={
            pausedByOpponent
              ? '对手已离开，对局已暂停；对手回来后会接着打（比分保留）。'
              : undefined
          }
        />
      ) : (
        <>
          <DuelStatusBar duel={duel} scores={scores} unit="分" />

          <div
            className="pong-wrap"
            onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => pointAt(event.clientX)}
            onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => pointAt(event.clientX)}
          >
            <canvas
              ref={canvasRef}
              className="pong-canvas"
              style={{ aspectRatio: `${W} / ${H}` }}
            />

            {phase === 'over' ? (
              <div className="overlay pong-overlay">
                <h2>{iWon ? '你赢了！🏓' : '对手赢了'}</h2>
                <p className="pong-final">
                  {scores[0]} : {scores[1]} · 先到 {WIN_SCORE} 分者胜
                </p>
                <button type="button" className="btn btn-primary" onClick={rematch}>
                  再来一局
                </button>
              </div>
            ) : null}
          </div>

          <p className="duel-status pong-status">{statusText}</p>
        </>
      )}
    </GameFrame>
  );
}
