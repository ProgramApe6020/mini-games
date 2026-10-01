import { useCallback, useEffect, useRef, useState } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { useDuel, useRoomParams, type Seat } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import './memory-duel.css';
import {
  applyFlip,
  evaluate,
  freshRound,
  isMyTurn,
  isRevealed,
  mismatchPending,
  parseState,
  settle,
  BOARD_SIZE,
  type State,
} from './memory-duel/logic';

const game = getGame('memory-duel')!;

/** 配对失败后两张牌摊在桌上的时间（两端各自本地计时，不需要同步）。 */
const MATCH_MISS_DELAY = 900;

/** 房主权威的完整快照：逻辑状态之外多带一份「痕迹」，用来显示谁配成了哪些牌。 */
type Snapshot = State & {
  /** 每张牌最后一次成功配对的座位 */
  owners: (Seat | null)[];
  /** 每张牌最后一次被翻开的座位，用来标出「对手翻过这张」 */
  marks: (Seat | null)[];
};

type FlipMessage = { seat: Seat; index: number };

function freshSnapshot(round: number, scores: [number, number]): Snapshot {
  return {
    ...freshRound(round, scores),
    owners: Array.from({ length: BOARD_SIZE }, () => null),
    marks: Array.from({ length: BOARD_SIZE }, () => null),
  };
}

/** 校验网络消息里的翻牌动作。 */
function parseFlip(input: unknown): FlipMessage | null {
  if (typeof input !== 'object' || input === null) return null;
  const value = input as Record<string, unknown>;
  if (value.seat !== 0 && value.seat !== 1) return null;
  if (typeof value.index !== 'number' || !Number.isInteger(value.index)) return null;
  return { seat: value.seat, index: value.index };
}

/** 从网络快照里补齐可选的痕迹字段。 */
function ownersOf(input: unknown): (Seat | null)[] {
  if (!Array.isArray(input) || input.length !== BOARD_SIZE) {
    return Array.from({ length: BOARD_SIZE }, () => null);
  }
  return input.map((item): Seat | null => (item === 0 || item === 1 ? item : null));
}

/**
 * 更新痕迹：`next` 比 `prev` 新翻开了哪些牌、配成了哪些牌。
 * 成功配对的记到 owners，其它新翻开的记到 marks。
 */
function markFlip(prev: Snapshot, next: Snapshot, seat: Seat): { owners: (Seat | null)[]; marks: (Seat | null)[] } {
  const owners = prev.owners.slice();
  const marks = prev.marks.slice();

  const matchedNow = next.matched.length > prev.matched.length;
  const freshlyOpened = matchedNow ? next.matched.filter((index) => !prev.matched.includes(index)) : next.flipped;

  for (const index of freshlyOpened) {
    marks[index] = matchedNow ? null : seat;
    if (matchedNow) owners[index] = seat;
  }
  return { owners, marks };
}

/**
 * 记忆翻牌对战（联机）。
 *
 * 协议（用 Broadcast 在房间里传）：
 *   state         房主 -> 全部：完整快照（对手进场、请求同步、一局结束时发）
 *   sync-request  客户端 -> 房主：我刚进来/刷新了，请把当前状态发我
 *   flip          任一方 -> 对方：我翻开了第 index 张（带操作者座位）
 *   restart       任一方 -> 对方：请求开下一局（带局数）
 *
 * 关键点：`flip` 只同步「谁翻了哪张」，配对 / 计分 / 换手 / 结束由两端各自用
 * `applyFlip` 这个纯函数算出来，输入相同结果必然相同；配对失败后的翻回是本地
 * 900ms 定时器调用 `settle`，同样不需要额外同步。牌阵只由房主生成并随 state 下发。
 */
export default function MemoryDuel() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);

  const [snapshot, setSnapshot] = useState<Snapshot>(() => freshSnapshot(0, [0, 0]));
  const [started, setStarted] = useState(false);
  const snapshotRef = useRef(snapshot);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const duel = useDuel({
    gameId: 'memory-duel',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'sync-request') {
        if (seat !== 0) return;
        // 有人要同步时先把摊着等翻回的一对收掉，别人接手才是干净的局面
        const current = settle(snapshotRef.current);
        snapshotRef.current = current;
        setSnapshot(current);
        api.send('state', current);
        return;
      }

      if (message.type === 'state') {
        const data = parseState(message.data);
        if (!data) return;
        const raw = message.data as Record<string, unknown>;
        setSnapshot({
          ...data,
          owners: ownersOf(raw.owners),
          marks: ownersOf(raw.marks),
        });
        setStarted(true);
        return;
      }

      if (message.type === 'flip') {
        const action = parseFlip(message.data);
        if (!action) return;
        setSnapshot((prev) => {
          const next = applyFlip(prev, action.seat, action.index);
          if (next === prev) return prev; // 非法翻牌（不是他回合 / 已翻开），忽略
          return { ...next, ...markFlip(prev, next, message.seat) };
        });
        return;
      }

      if (message.type === 'restart') {
        const data = message.data as { round?: unknown } | undefined;
        const round = typeof data?.round === 'number' && Number.isFinite(data.round) ? Math.trunc(data.round) : 0;
        // 新牌阵只由房主生成：房主直接开局并广播，客户端只等 state
        if (seat !== 0) return;
        const next = freshSnapshot(round, snapshotRef.current.scores);
        snapshotRef.current = next;
        setSnapshot(next);
        setStarted(true);
        api.send('state', next);
      }
    },
  });

  const { send, isHost, status } = duel;

  // 对手到齐后，房主开局并把牌阵同步过去
  useEffect(() => {
    if (status === 'ready' && isHost) {
      setStarted(true);
      send('state', snapshotRef.current);
    }
  }, [status, isHost, send]);

  // 客户端进场 / 刷新后主动要一次状态
  useEffect(() => {
    if (status === 'ready' && !isHost && !started) {
      const timer = window.setTimeout(() => send('sync-request'), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [status, isHost, started, send]);

  // 配对失败：两端各自等 900ms 后本地翻回、换手
  useEffect(() => {
    if (status !== 'ready' || !mismatchPending(snapshot)) return undefined;
    const timer = window.setTimeout(() => {
      setSnapshot((prev) => {
        const next = settle(prev);
        if (next === prev) return prev;
        // 房主顺手广播一次收尾快照，避免两端节奏漂移
        if (isHost) send('state', next);
        return next;
      });
    }, MATCH_MISS_DELAY);
    return () => window.clearTimeout(timer);
  }, [snapshot, status, isHost, send]);

  const outcome = evaluate(snapshot);
  const myTurn = started && status === 'ready' && isMyTurn(snapshot, seat);
  const busy = mismatchPending(snapshot);
  const finished = outcome.kind === 'over';

  const flip = useCallback(
    (index: number) => {
      const current = snapshotRef.current;
      if (!isMyTurn(current, seat)) return;
      const next = applyFlip(current, seat, index);
      if (next === current) return;

      const applied: Snapshot = { ...next, ...markFlip(current, next, seat) };
      snapshotRef.current = applied;
      setSnapshot(applied);
      send('flip', { seat, index });
      // 这一翻结束了整局：房主再广播一次，兜底对齐另一端
      if (isHost && evaluate(applied).kind !== 'playing') send('state', applied);
    },
    [seat, send, isHost],
  );

  const restart = useCallback(() => {
    const current = snapshotRef.current;
    const round = current.round + 1;
    if (!isHost) {
      // 客户端只是请求：新牌阵必须由房主生成并广播，否则两端各洗一副牌
      send('restart', { round });
      return;
    }
    const next = freshSnapshot(round, current.scores);
    snapshotRef.current = next;
    setSnapshot(next);
    send('state', next);
  }, [isHost, send]);

  const statusText = finished
    ? outcome.winner === null
      ? '平局，谁也没赢'
      : outcome.winner === seat
        ? '这一局你赢了 🎉'
        : '这一局对手赢了'
    : !started
      ? '正在同步牌阵…'
      : status === 'waiting'
        ? '对手已离开，等待重新连接…'
        : busy
          ? '没配上，牌要翻回去了…'
          : myTurn
            ? snapshot.flipped.length > 0
              ? '你配对成功，继续翻'
              : '轮到你翻牌'
            : '等待对手翻牌…';

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
          <DuelStatusBar duel={duel} scores={snapshot.scores} unit="配对" />

          <div className="memory-duel-column">
            <div className="memory-duel-grid">
              {snapshot.deck.map((emoji, index) => {
                const revealed = isRevealed(snapshot, index);
                const matched = snapshot.matched.includes(index);
                // 还没收到房主牌阵前不允许点：否则一旦客户端自己洗的牌被看到，就穿帮了
                const playable = started && myTurn && !revealed;
                // 同步完成前不显示牌面（那只是本地占位的牌阵）
                const face = started ? emoji : '?';
                const owner = snapshot.owners[index] ?? null;
                const marked = snapshot.marks[index] ?? null;
                const classes = ['memory-duel-card'];
                if (revealed) classes.push('is-open');
                if (matched) classes.push('is-matched');
                if (playable) classes.push('is-playable');
                if (owner !== null && owner !== seat) classes.push('is-rival');

                return (
                  <button
                    key={index}
                    type="button"
                    className={classes.join(' ')}
                    onClick={() => flip(index)}
                    disabled={!playable}
                    aria-label={revealed ? face : marked !== null ? '对手翻过这张牌' : '未翻开的卡片'}
                  >
                    <span className="memory-duel-inner">
                      <span className="memory-duel-face memory-duel-front">{marked !== null && !revealed ? '·' : '?'}</span>
                      <span className="memory-duel-face memory-duel-back">{face}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            <p
              className={`memory-duel-status${
                finished && outcome.winner === seat
                  ? ' memory-duel-win'
                  : finished && outcome.winner !== null
                    ? ' memory-duel-lose'
                    : ''
              }`}
            >
              {statusText}
            </p>

            {finished ? (
              <button type="button" className="btn btn-primary" onClick={restart}>
                再来一局
              </button>
            ) : null}
          </div>
        </>
      )}
    </GameFrame>
  );
}
