import { useCallback, useEffect, useRef, useState } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { useDuel, useRoomParams, type Seat } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import {
  canPlay,
  emptyBoard,
  evaluate,
  markFor,
  withMove,
  type Board,
  type Mark,
} from './tictactoe/logic';

const game = getGame('tictactoe')!;

/** 一次对局的完整状态。房主是这份状态的权威来源，客户端收到后直接采用。 */
type Snapshot = {
  board: Board;
  turn: Seat;
  round: number;
  scores: [number, number];
};

function freshSnapshot(round: number, scores: [number, number]): Snapshot {
  return { board: emptyBoard(), turn: (round % 2) as Seat, round, scores };
}

/**
 * 井字棋联机对战——也是其它联机游戏的参考实现。
 *
 * 协议（用 Broadcast 在房间里传）：
 *   state         房主 -> 全部：完整快照（对手进场、请求同步、对局结束时发）
 *   sync-request  客户端 -> 房主：我刚进来/刷新了，请把当前状态发我
 *   move          任一方 -> 对方：我在某个位置落子
 *   restart       任一方 -> 对方：开始下一局（带上局数，双方据此算出谁先手）
 */
export default function TicTacToe() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);

  const [snapshot, setSnapshot] = useState<Snapshot>(() => freshSnapshot(0, [0, 0]));
  const [started, setStarted] = useState(false);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const applyOutcome = useCallback((board: Board, base: Snapshot): [number, number] => {
    const outcome = evaluate(board);
    const scores: [number, number] = [base.scores[0], base.scores[1]];
    if (outcome.kind === 'win') {
      if (outcome.mark === 1) scores[0] += 1;
      else scores[1] += 1;
    }
    return scores;
  }, []);

  const duel = useDuel({
    gameId: 'tictactoe',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'sync-request') {
        if (seat === 0) api.send('state', snapshotRef.current);
        return;
      }

      if (message.type === 'state') {
        const data = message.data as Snapshot | undefined;
        if (!data || !Array.isArray(data.board)) return;
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
            turn: (prev.turn === 0 ? 1 : 0) as Seat,
            scores: applyOutcome(board, prev),
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

  const outcome = evaluate(snapshot.board);
  const myTurn = started && status === 'ready' && snapshot.turn === seat && outcome.kind === 'playing';

  const play = (index: number) => {
    if (!myTurn || !canPlay(snapshot.board, index)) return;
    const mark = markFor(seat);
    const board = withMove(snapshot.board, index, mark);
    const next: Snapshot = {
      ...snapshot,
      board,
      turn: (seat === 0 ? 1 : 0) as Seat,
      scores: applyOutcome(board, snapshot),
    };
    setSnapshot(next);
    send('move', { index, mark });
    // 分胜负后由房主再广播一次快照，确保两边计分一致
    if (isHost && evaluate(board).kind !== 'playing') send('state', next);
  };

  const restart = () => {
    const round = snapshot.round + 1;
    const next = freshSnapshot(round, snapshot.scores);
    setSnapshot(next);
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
          ? '平局，谁也没赢'
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

          <div className="ttt-board">
            {snapshot.board.map((mark, index) => (
              <button
                key={index}
                type="button"
                className={`ttt-cell mark-${mark}${myTurn && mark === 0 ? ' is-playable' : ''}`}
                onClick={() => play(index)}
                disabled={!myTurn || mark !== 0}
                aria-label={`第 ${index + 1} 格`}
              >
                {mark === 1 ? '✕' : mark === 2 ? '○' : ''}
              </button>
            ))}
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
