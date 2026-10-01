import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { setupCanvas } from '../../lib/canvas';
import { useDuel, useRoomParams, type Seat } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import {
  BOARD_PX,
  CELL,
  CELLS,
  GRID_PAD,
  SIZE,
  WIN_LENGTH,
  canPlay,
  colOf,
  emptyBoard,
  evaluate,
  markFor,
  otherSeat,
  pointToIndex,
  rowOf,
  turnForRound,
  withMove,
  withOutcomeScore,
  type Board,
  type Mark,
} from './gomoku/logic';
import './gomoku.css';

const game = getGame('gomoku')!;

/** 一次对局的完整状态。房主是这份状态的权威来源，客户端收到后直接采用。 */
type Snapshot = {
  board: Board;
  turn: Seat;
  round: number;
  scores: [number, number];
  /** 最后一手的位置，null 表示本局还没落子（用来在棋盘上做标记） */
  last: number | null;
};

function freshSnapshot(round: number, scores: [number, number]): Snapshot {
  return { board: emptyBoard(), turn: turnForRound(round), round, scores, last: null };
}

/** 把网络里收到的未知数据收敛成可用的快照；结构不对返回 null。 */
function readSnapshot(raw: unknown): Snapshot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Partial<Snapshot>;
  // 棋盘必须是完整的 225 格，否则宁可不同步，也不要采用一副长度不对的棋盘
  if (!Array.isArray(data.board) || data.board.length !== CELLS) return null;

  const scores = Array.isArray(data.scores) ? data.scores : [0, 0];
  return {
    board: data.board,
    turn: data.turn === 1 ? 1 : 0,
    round: typeof data.round === 'number' ? data.round : 0,
    scores: [Number(scores[0]) || 0, Number(scores[1]) || 0],
    last: typeof data.last === 'number' ? data.last : null,
  };
}

/** 星位：传统五子棋的五个参考点。 */
const STAR_POINTS: ReadonlyArray<readonly [number, number]> = [
  [3, 3],
  [3, 11],
  [7, 7],
  [11, 3],
  [11, 11],
];

const STONE_R = CELL / 2 - 3;
const ACCENT = game.accent;

/** 交叉点的画布逻辑坐标。 */
function pointOf(index: number): { x: number; y: number } {
  return { x: GRID_PAD + colOf(index) * CELL, y: GRID_PAD + rowOf(index) * CELL };
}

function drawStone(ctx: CanvasRenderingContext2D, x: number, y: number, mark: Mark): void {
  const gradient = ctx.createRadialGradient(
    x - STONE_R * 0.35,
    y - STONE_R * 0.4,
    STONE_R * 0.2,
    x,
    y,
    STONE_R,
  );
  if (mark === 1) {
    gradient.addColorStop(0, '#55688c');
    gradient.addColorStop(1, '#121b2d');
  } else {
    gradient.addColorStop(0, '#ffffff');
    gradient.addColorStop(1, '#c3cee2');
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 2;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = mark === 1 ? 'rgba(203,213,225,.5)' : 'rgba(15,23,42,.35)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, STONE_R - 0.5, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * 画整块棋盘：底、网格、星位、获胜的五连线、所有棋子、最后一手、鼠标预览。
 * 全部用逻辑坐标（BOARD_PX），高分屏的缩放由 setupCanvas 处理。
 */
function drawBoard(
  ctx: CanvasRenderingContext2D,
  board: Board,
  last: number | null,
  winLine: readonly number[] | null,
  preview: number | null,
): void {
  const bg = ctx.createLinearGradient(0, 0, BOARD_PX, BOARD_PX);
  bg.addColorStop(0, '#111c31');
  bg.addColorStop(1, '#0a1120');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, BOARD_PX, BOARD_PX);

  // 网格
  ctx.strokeStyle = 'rgba(148,163,184,.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < SIZE; i += 1) {
    const pos = GRID_PAD + i * CELL;
    ctx.moveTo(GRID_PAD, pos);
    ctx.lineTo(BOARD_PX - GRID_PAD, pos);
    ctx.moveTo(pos, GRID_PAD);
    ctx.lineTo(pos, BOARD_PX - GRID_PAD);
  }
  ctx.stroke();

  // 星位
  ctx.fillStyle = 'rgba(148,163,184,.55)';
  for (const [row, col] of STAR_POINTS) {
    ctx.beginPath();
    ctx.arc(GRID_PAD + col * CELL, GRID_PAD + row * CELL, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 获胜的五连线：先铺一条发光的带子（垫在棋子下面）
  if (winLine && winLine.length >= WIN_LENGTH) {
    const start = pointOf(winLine[0]);
    const end = pointOf(winLine[winLine.length - 1]);
    ctx.save();
    ctx.globalAlpha = 0.45;
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = CELL * 0.36;
    ctx.lineCap = 'round';
    ctx.shadowColor = ACCENT;
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.restore();
  }

  // 棋子
  const count = Math.min(board.length, CELLS);
  for (let index = 0; index < count; index += 1) {
    const mark = board[index];
    if (!mark) continue;
    const { x, y } = pointOf(index);
    drawStone(ctx, x, y, mark);
  }

  // 获胜的棋子上再描一圈
  if (winLine) {
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2.5;
    for (const index of winLine) {
      const { x, y } = pointOf(index);
      ctx.beginPath();
      ctx.arc(x, y, STONE_R + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // 最后一手：棋子中心点一下
  if (last !== null && last >= 0 && last < CELLS && board[last]) {
    const { x, y } = pointOf(last);
    ctx.fillStyle = board[last] === 1 ? '#7dd3fc' : '#0f172a';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // 鼠标停留处的落子预览（只在自己回合显示）
  if (preview !== null && preview >= 0 && preview < CELLS && board[preview] === 0) {
    const { x, y } = pointOf(preview);
    ctx.fillStyle = 'rgba(226,232,240,.16)';
    ctx.beginPath();
    ctx.arc(x, y, STONE_R, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * 五子棋联机对战，结构与井字棋联机版保持一致。
 *
 * 协议（用 Broadcast 在房间里传）：
 *   state         房主 -> 全部：完整快照（对手进场、请求同步、对局结束时发）
 *   sync-request  客户端 -> 房主：我刚进来/刷新了，请把当前状态发我
 *   move          任一方 -> 对方：我在某个交叉点落子
 *   restart       任一方 -> 对方：开始下一局（带上局数，双方据此算出谁先手）
 *
 * 双方各自在本地应用对方的落子，所以两条棋盘完全一致；
 * 分胜负后房主再广播一次快照，保证比分一致。
 */
export default function Gomoku() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);

  const [snapshot, setSnapshot] = useState<Snapshot>(() => freshSnapshot(0, [0, 0]));
  const [started, setStarted] = useState(false);
  const [hover, setHover] = useState<number | null>(null);
  const snapshotRef = useRef(snapshot);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const duel = useDuel({
    gameId: 'gomoku',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'sync-request') {
        if (seat === 0) api.send('state', snapshotRef.current);
        return;
      }

      if (message.type === 'state') {
        const data = readSnapshot(message.data);
        if (!data) return;
        setSnapshot(data);
        setStarted(true);
        return;
      }

      if (message.type === 'move') {
        const data = message.data as { index: number; mark: Mark } | undefined;
        if (!data) return;
        setSnapshot((prev) => {
          const board = withMove(prev.board, data.index, data.mark);
          if (board === prev.board) return prev; // 非法落子，忽略
          return {
            ...prev,
            board,
            turn: otherSeat(prev.turn),
            scores: withOutcomeScore(board, prev.scores),
            last: data.index,
          };
        });
        return;
      }

      if (message.type === 'restart') {
        const data = message.data as { round: number } | undefined;
        const round = typeof data?.round === 'number' ? data.round : 0;
        setSnapshot((prev) => freshSnapshot(round, prev.scores));
        setStarted(true);
      }
    },
  });

  const { send, isHost, status } = duel;

  // 对手到齐后，房主开始对局并把自己的状态同步过去
  useEffect(() => {
    if (status === 'ready' && isHost) {
      setStarted(true);
      send('state', snapshotRef.current);
    }
  }, [status, isHost, send]);

  // 客户端进场/刷新后主动要一次状态
  useEffect(() => {
    if (status === 'ready' && !isHost && !started) {
      const timer = window.setTimeout(() => send('sync-request'), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status, isHost, started, send]);

  const outcome = useMemo(() => evaluate(snapshot.board), [snapshot.board]);
  const winLine = outcome.kind === 'win' ? outcome.line : null;
  // 分胜负后由房主再广播一次快照，保证两边棋盘与比分一致。
  // 放在 effect 里（而不是只在自己落子获胜时发），对方落子获胜那一局也能覆盖；
  // settledRef 去重，避免同一次结算反复广播，新一局开始时自动重置。
  const settledRef = useRef(false);
  useEffect(() => {
    if (outcome.kind === 'playing') {
      settledRef.current = false;
      return;
    }
    if (!isHost || status !== 'ready' || settledRef.current) return;
    settledRef.current = true;
    send('state', snapshot);
  }, [outcome, snapshot, isHost, status, send]);

  const myTurn = started && status === 'ready' && snapshot.turn === seat && outcome.kind === 'playing';

  // 棋盘重绘：棋盘、最后一手、胜负线、鼠标预览任一变化都重画。
  // status 也要作为依赖：画布是在 status 变成 ready 的那一次渲染里才挂上的，
  // 若只盯着棋盘，客户端（轮到对手时 myTurn 始终为 false）会一直白板。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = setupCanvas(canvas, BOARD_PX, BOARD_PX);
    if (!ctx) return;
    drawBoard(ctx, snapshot.board, snapshot.last, winLine, myTurn ? hover : null);
  }, [status, snapshot.board, snapshot.last, winLine, myTurn, hover]);

  /** 把点击/移动的屏幕坐标换算成棋盘上的交叉点。 */
  const indexFromEvent = (event: MouseEvent<HTMLCanvasElement>): number | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return pointToIndex(
      ((event.clientX - rect.left) / rect.width) * BOARD_PX,
      ((event.clientY - rect.top) / rect.height) * BOARD_PX,
    );
  };

  const play = (index: number) => {
    if (!myTurn || !canPlay(snapshot.board, index)) return;
    const mark = markFor(seat);
    const board = withMove(snapshot.board, index, mark);
    const next: Snapshot = {
      ...snapshot,
      board,
      turn: otherSeat(seat),
      scores: withOutcomeScore(board, snapshot.scores),
      last: index,
    };
    setSnapshot(next);
    send('move', { index, mark });
    // 分胜负的话，上面的 effect 会以房主身份再广播一次快照
  };

  const onCanvasClick = (event: MouseEvent<HTMLCanvasElement>) => {
    const index = indexFromEvent(event);
    if (index === null) return;
    play(index);
  };

  const onCanvasMove = (event: MouseEvent<HTMLCanvasElement>) => {
    setHover(myTurn ? indexFromEvent(event) : null);
  };

  const restart = () => {
    const round = snapshot.round + 1;
    const next = freshSnapshot(round, snapshot.scores);
    setSnapshot(next);
    setHover(null);
    send('restart', { round });
  };

  const statusText = !started
    ? '正在同步棋盘…'
    : status === 'waiting'
      ? '对手已离开，等待重新连接…'
      : outcome.kind === 'win'
        ? outcome.mark === markFor(seat)
          ? '这一局你赢了 🎉'
          : '这一局对手赢了'
        : outcome.kind === 'draw'
          ? '平局，棋盘满了，谁也没连成五子'
          : myTurn
            ? '轮到你落子'
            : '等待对手落子…';

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
          <DuelStatusBar duel={duel} scores={snapshot.scores} unit="胜局" />

          <div className="gomoku-board">
            <canvas
              ref={canvasRef}
              className={`gomoku-canvas${myTurn ? ' is-playable' : ''}`}
              style={{ aspectRatio: '1 / 1' }}
              role="img"
              aria-label={`五子棋棋盘，第 ${snapshot.round + 1} 局`}
              onClick={onCanvasClick}
              onMouseMove={onCanvasMove}
              onMouseLeave={() => setHover(null)}
            />
          </div>

          <div className="gomoku-meta">
            <span className={`gomoku-chip${seat === 0 ? ' is-self' : ''}`}>
              <i className="gomoku-stone is-black" aria-hidden="true" />
              黑（玩家 1）{seat === 0 ? ' · 你' : ''}
            </span>
            <span className={`gomoku-chip${seat === 1 ? ' is-self' : ''}`}>
              <i className="gomoku-stone is-white" aria-hidden="true" />
              白（玩家 2）{seat === 1 ? ' · 你' : ''}
            </span>
            <span className="gomoku-round">第 {snapshot.round + 1} 局</span>
          </div>

          <p className="duel-status">{statusText}</p>

          {outcome.kind !== 'playing' ? (
            <button type="button" className="btn btn-primary" onClick={restart}>
              再来一局
            </button>
          ) : null}
        </>
      )}
    </GameFrame>
  );
}
