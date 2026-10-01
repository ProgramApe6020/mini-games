import { useCallback, useEffect, useRef, useState } from 'react';
import type { TouchEvent } from 'react';
import GameFrame from '../components/GameFrame';
import { roundRect, setupCanvas } from '../lib/canvas';
import { useBestScore } from '../lib/storage';
import { getGame } from './registry';
import {
  BOARD_H,
  BOARD_W,
  CELL,
  COLS,
  ROWS,
  advance,
  createState,
  queueDirection,
  togglePause,
  type DirectionName,
  type Phase,
  type SnakeState,
} from './snake/logic';

const game = getGame('snake')!;

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

function draw(ctx: CanvasRenderingContext2D, state: SnakeState, time: number): void {
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

  // 蛇身：从头部到尾部颜色逐渐变暗
  const total = Math.max(state.snake.length - 1, 1);
  state.snake.forEach((seg, index) => {
    const t = index / total;
    const pad = index === 0 ? 1.5 : 2.6;
    ctx.save();
    if (index === 0) {
      ctx.shadowColor = 'rgba(74,222,128,.55)';
      ctx.shadowBlur = 12;
    }
    ctx.fillStyle = index === 0 ? '#86efac' : `hsl(${146 + t * 24} 62% ${56 - t * 18}%)`;
    roundRect(ctx, seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 7);
    ctx.fill();
    ctx.restore();
  });

  // 眼睛：跟着当前方向转
  const head = state.snake[0]!;
  const cx = head.x * CELL + CELL / 2;
  const cy = head.y * CELL + CELL / 2;
  const dir = state.dir;
  const spread = 4.6;
  const forward = 3.2;
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
    ctx.arc(eye.x, eye.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export default function Snake() {
  const [initial] = useState<SnakeState>(createState);
  const stateRef = useRef<SnakeState>(initial);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSyncRef = useRef({ phase: 'ready' as Phase, score: 0 });
  const submittedRef = useRef(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [record, setRecord] = useState(false);
  const [best, submitBest] = useBestScore('snake', 'max');

  const reset = useCallback(() => {
    const fresh = createState();
    fresh.phase = 'running';
    stateRef.current = fresh;
    submittedRef.current = false;
    lastSyncRef.current = { phase: 'running', score: 0 };
    setPhase('running');
    setScore(0);
    setRecord(false);
  }, []);

  const turn = useCallback((name: DirectionName) => {
    queueDirection(stateRef.current, name);
  }, []);

  const pause = useCallback(() => {
    const state = stateRef.current;
    if (state.phase === 'over') {
      reset();
      return;
    }
    togglePause(state);
  }, [reset]);

  // 键盘操作
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const direction = KEY_TO_DIRECTION[key];
      if (direction) {
        event.preventDefault();
        turn(direction);
        return;
      }
      if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        if (stateRef.current.phase === 'over') reset();
        else pause();
        return;
      }
      if (key === 'enter' || key === 'r') {
        event.preventDefault();
        reset();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [turn, pause, reset]);

  // 游戏主循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, BOARD_W, BOARD_H);
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);

      const dt = Math.min(now - last, 120);
      last = now;

      const state = stateRef.current;
      if (state.phase === 'running') {
        state.acc += dt;
        let guard = 0;
        while (state.acc >= state.stepMs && state.phase === 'running' && guard < 8) {
          state.acc -= state.stepMs;
          advance(state);
          guard += 1;
        }
      } else {
        state.acc = 0;
      }

      draw(ctx, state, now);

      if (state.phase === 'over' && !submittedRef.current) {
        submittedRef.current = true;
        if (state.score > 0) setRecord(submitBest(state.score));
      }

      const synced = lastSyncRef.current;
      if (synced.phase !== state.phase || synced.score !== state.score) {
        lastSyncRef.current = { phase: state.phase, score: state.score };
        setPhase(state.phase);
        setScore(state.score);
      }
    };

    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [submitBest]);

  // 手机上滑动屏幕转向
  const onTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    const touch = event.touches[0];
    if (touch) touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchStartRef.current;
    const touch = event.changedTouches[0];
    touchStartRef.current = null;
    if (!start || !touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;

    if (Math.abs(dx) > Math.abs(dy)) turn(dx > 0 ? 'right' : 'left');
    else turn(dy > 0 ? 'down' : 'up');
  };

  const pauseLabel =
    phase === 'running' ? '暂停' : phase === 'paused' ? '继续' : phase === 'over' ? '再来一局' : '开始';

  return (
    <GameFrame game={game} score={score} best={best} hint={game.controls}>
      <div className="snake-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <canvas
          ref={canvasRef}
          className="snake-canvas"
          style={{ aspectRatio: `${BOARD_W} / ${BOARD_H}` }}
        />
        {phase !== 'running' ? (
          <div className="overlay">
            {phase === 'ready' ? (
              <>
                <h2>准备好了吗？</h2>
                <p>按方向键 / WASD，或点下面的方向按钮开始</p>
              </>
            ) : null}
            {phase === 'paused' ? (
              <>
                <h2>已暂停</h2>
                <p>按空格继续</p>
              </>
            ) : null}
            {phase === 'over' ? (
              <>
                <h2>游戏结束</h2>
                <p>
                  本局得分 {score}
                  {record ? ' · 新纪录！' : ''}
                </p>
                <button type="button" className="btn btn-primary" onClick={reset}>
                  再来一局
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="tool-row">
        <button type="button" className="btn" onClick={pause}>
          {pauseLabel}
        </button>
        <button type="button" className="btn" onClick={reset}>
          重新开始
        </button>
      </div>

      <div className="dpad">
        <button type="button" className="dpad-up" onClick={() => turn('up')} aria-label="向上">
          ↑
        </button>
        <button type="button" className="dpad-left" onClick={() => turn('left')} aria-label="向左">
          ←
        </button>
        <button type="button" className="dpad-right" onClick={() => turn('right')} aria-label="向右">
          →
        </button>
        <button type="button" className="dpad-down" onClick={() => turn('down')} aria-label="向下">
          ↓
        </button>
      </div>
    </GameFrame>
  );
}
