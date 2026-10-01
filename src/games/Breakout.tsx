import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import GameFrame from '../components/GameFrame';
import { roundRect, setupCanvas } from '../lib/canvas';
import { clamp } from '../lib/math';
import { useBestScore } from '../lib/storage';
import {
  BALL_R,
  H,
  PADDLE_H,
  PADDLE_W,
  PADDLE_Y,
  W,
  createState,
  launch,
  update,
  type BreakoutState,
  type Keys,
  type Phase,
} from './breakout/logic';
import { getGame } from './registry';

const game = getGame('breakout')!;

function draw(ctx: CanvasRenderingContext2D, state: BreakoutState): void {
  const background = ctx.createLinearGradient(0, 0, 0, H);
  background.addColorStop(0, '#0c1426');
  background.addColorStop(1, '#070b16');
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, W, H);

  for (const brick of state.bricks) {
    if (!brick.alive) continue;
    ctx.save();
    ctx.shadowColor = brick.color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = brick.color;
    roundRect(ctx, brick.x, brick.y, brick.w, brick.h, 5);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    roundRect(ctx, brick.x + 3, brick.y + 3, brick.w - 6, 4, 2);
    ctx.fill();
  }

  for (const particle of state.particles) {
    ctx.globalAlpha = Math.max(particle.life / particle.max, 0);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x - 2, particle.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  const paddleX = state.paddleCx - PADDLE_W / 2;
  const paddleGradient = ctx.createLinearGradient(paddleX, 0, paddleX + PADDLE_W, 0);
  paddleGradient.addColorStop(0, '#60a5fa');
  paddleGradient.addColorStop(0.5, '#c7d2fe');
  paddleGradient.addColorStop(1, '#60a5fa');
  ctx.save();
  ctx.shadowColor = 'rgba(96,165,250,.65)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = paddleGradient;
  roundRect(ctx, paddleX, PADDLE_Y, PADDLE_W, PADDLE_H, 6);
  ctx.fill();
  ctx.restore();

  const { ball } = state;
  const ballGradient = ctx.createRadialGradient(ball.x - 2, ball.y - 2, 1, ball.x, ball.y, BALL_R);
  ballGradient.addColorStop(0, '#ffffff');
  ballGradient.addColorStop(1, '#93c5fd');
  ctx.save();
  ctx.shadowColor = 'rgba(226,232,240,.85)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = ballGradient;
  ctx.beginPath();
  ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export default function Breakout() {
  const [initial] = useState<BreakoutState>(() => createState());
  const stateRef = useRef<BreakoutState>(initial);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const keysRef = useRef<Keys>({ left: false, right: false });
  const submittedRef = useRef(false);
  const lastSyncRef = useRef({ phase: 'ready' as Phase, score: 0, lives: 3, level: 1 });

  const [phase, setPhase] = useState<Phase>('ready');
  const [score, setScore] = useState(0);
  const [lives, setLives] = useState(3);
  const [level, setLevel] = useState(1);
  const [record, setRecord] = useState(false);
  const [best, submitBest] = useBestScore('breakout', 'max');

  // 把游戏状态里的数值同步给 React，用于标题栏和遮罩
  const sync = (state: BreakoutState) => {
    lastSyncRef.current = {
      phase: state.phase,
      score: state.score,
      lives: state.lives,
      level: state.level,
    };
    setPhase(state.phase);
    setScore(state.score);
    setLives(state.lives);
    setLevel(state.level);
  };

  const restart = useCallback(() => {
    const fresh = createState();
    stateRef.current = fresh;
    submittedRef.current = false;
    keysRef.current = { left: false, right: false };
    sync(fresh);
    setRecord(false);
  }, []);

  const nextLevel = useCallback(() => {
    const current = stateRef.current;
    const fresh = createState(current.level + 1, current.score, current.lives);
    stateRef.current = fresh;
    sync(fresh);
  }, []);

  const launchBall = useCallback(() => {
    const state = stateRef.current;
    if (state.phase === 'ready') launch(state);
    else if (state.phase === 'paused') state.phase = 'running';
  }, []);

  const togglePause = useCallback(() => {
    const state = stateRef.current;
    if (state.phase === 'running') state.phase = 'paused';
    else if (state.phase === 'paused') state.phase = 'running';
  }, []);

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * W;
    stateRef.current.targetCx = clamp(x, PADDLE_W / 2, W - PADDLE_W / 2);
  };

  // 键盘：空格发球 / 暂停，← → 或 A D 移动挡板
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') {
        event.preventDefault();
        keysRef.current.left = true;
        launchBall();
        return;
      }
      if (key === 'arrowright' || key === 'd') {
        event.preventDefault();
        keysRef.current.right = true;
        launchBall();
        return;
      }
      if (key === ' ' || key === 'spacebar') {
        event.preventDefault();
        const state = stateRef.current;
        if (state.phase === 'over') restart();
        else if (state.phase === 'cleared') nextLevel();
        else if (state.phase === 'ready') launch(state);
        else togglePause();
        return;
      }
      if (key === 'r') {
        event.preventDefault();
        restart();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === 'arrowleft' || key === 'a') keysRef.current.left = false;
      if (key === 'arrowright' || key === 'd') keysRef.current.right = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [launchBall, nextLevel, restart, togglePause]);

  // 游戏主循环
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, W, H);
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const frame = (now: number) => {
      raf = window.requestAnimationFrame(frame);

      // 限制单帧步长：切到后台再回来时不会一帧穿墙
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      const state = stateRef.current;
      update(state, dt, keysRef.current);
      draw(ctx, state);

      if (state.phase === 'over' && !submittedRef.current) {
        submittedRef.current = true;
        if (state.score > 0) setRecord(submitBest(state.score));
      }

      const synced = lastSyncRef.current;
      if (
        synced.phase !== state.phase ||
        synced.score !== state.score ||
        synced.lives !== state.lives ||
        synced.level !== state.level
      ) {
        sync(state);
      }
    };

    raf = window.requestAnimationFrame(frame);
    return () => window.cancelAnimationFrame(raf);
  }, [submitBest]);

  const controlDisabled = phase === 'over' || phase === 'cleared' || phase === 'ready';

  return (
    <GameFrame
      game={game}
      score={score}
      best={best}
      extra={
        <>
          <div className="pill">
            <span>关卡</span>
            <strong>{level}</strong>
          </div>
          <div className="pill">
            <span>生命</span>
            <strong>{lives > 0 ? '❤'.repeat(lives) : '—'}</strong>
          </div>
        </>
      }
      hint={game.controls}
    >
      <div className="breakout-wrap" onPointerMove={onPointerMove}>
        <canvas ref={canvasRef} className="breakout-canvas" style={{ aspectRatio: `${W} / ${H}` }} />

        {phase !== 'running' ? (
          <div className="overlay" onPointerDown={(event) => event.stopPropagation()}>
            {phase === 'ready' ? (
              <>
                <h2>准备发球</h2>
                <p>点击画面、按空格或方向键发球</p>
                <button type="button" className="btn btn-primary" onClick={launchBall}>
                  发球
                </button>
              </>
            ) : null}
            {phase === 'paused' ? (
              <>
                <h2>已暂停</h2>
                <p>按空格继续</p>
                <button type="button" className="btn btn-primary" onClick={togglePause}>
                  继续
                </button>
              </>
            ) : null}
            {phase === 'cleared' ? (
              <>
                <h2>第 {level} 关通过！</h2>
                <p>当前得分 {score}</p>
                <button type="button" className="btn btn-primary" onClick={nextLevel}>
                  进入第 {level + 1} 关
                </button>
              </>
            ) : null}
            {phase === 'over' ? (
              <>
                <h2>游戏结束</h2>
                <p>
                  本局得分 {score}
                  {record ? ' · 新纪录！' : ''}
                </p>
                <button type="button" className="btn btn-primary" onClick={restart}>
                  再来一局
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="tool-row">
        <button type="button" className="btn" onClick={togglePause} disabled={controlDisabled}>
          {phase === 'paused' ? '继续' : '暂停'}
        </button>
        <button type="button" className="btn" onClick={restart}>
          重新开始
        </button>
      </div>
    </GameFrame>
  );
}
