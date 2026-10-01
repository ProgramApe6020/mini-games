import { useCallback, useEffect, useRef, useState } from 'react';
import GameFrame from '../../components/GameFrame';
import { DuelStatusBar, LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { useDuel, useRoomParams, type DuelApi, type Seat } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';
import {
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  NEXT_ROUND_DELAY_MS,
  RESULT_TIMEOUT_MS,
  WINS_TO_MATCH,
  applyOutcome,
  clampDelayMs,
  emptySeries,
  formatResult,
  judgeRound,
  matchWinner,
  parseMatchOver,
  parseRoundResult,
  parseRoundResultMessage,
  randomDelayMs,
  reactionMs,
  upcomingRoundId,
  winnerText,
  type RoundOutcome,
  type RoundResult,
  type RoundResults,
  type SeatIndex,
  type Series,
} from './reaction/logic';
import './reaction.css';

const game = getGame('reaction')!;

/** 本局进行到哪一步。 */
type Phase =
  | 'idle' // 还没开局（房主马上会发第一条 round）
  | 'waiting' // 收到了 round，正在等 delayMs 过去
  | 'go' // 已经出现「点！」，等玩家出手
  | 'pressed' // 自己出手了，等对手 / 等房主判定
  | 'round-result' // 本局结果已出，等待下一局
  | 'over'; // 整场结束

/** 一次对局的完整状态。房主负责推进，客户端收到消息后同步。 */
type Snapshot = {
  series: Series;
  matchNumber: number;
  /** 第几局，从 1 开始 */
  round: number;
  roundId: string;
  phase: Phase;
  /** 本局「点！」出现的本地时刻（performance.now()），准备阶段为 null */
  goAt: number | null;
  /** 本局双方的结果 */
  results: RoundResults;
  /** 本局判定（round-result / over 阶段有值） */
  outcome: RoundOutcome | null;
  /** 整场胜者（仅 over 阶段有值） */
  seriesWinner: SeatIndex | null;
};

/** 开一盘新比赛（比分 0:0）的初始快照。 */
function freshSeriesSnapshot(matchNumber: number): Snapshot {
  return {
    series: emptySeries(),
    matchNumber,
    round: 0,
    roundId: '',
    phase: 'idle',
    goAt: null,
    results: {},
    outcome: null,
    seriesWinner: null,
  };
}

/** 大色块的状态配色。 */
function phaseClass(phase: Phase, outcome: RoundOutcome | null, seat: Seat): string {
  if (phase === 'round-result') {
    if (!outcome || outcome.winner === null) return 'is-draw';
    return outcome.winner === seat ? 'is-win' : 'is-lose';
  }
  switch (phase) {
    case 'waiting':
      return 'is-armed';
    case 'go':
      return 'is-go';
    case 'pressed':
      return 'is-pressed';
    case 'over':
      return 'is-over';
    case 'idle':
      return 'is-idle';
    default:
      return 'is-idle';
  }
}

/**
 * 抢答反应对决（五局三胜）。
 *
 * 协议：
 *   round         房主 -> 全部：开一局，带 { roundId, delayMs, round }；双方从「收到消息」起各等 delayMs
 *   result        任一方 -> 对方：本局出手结果 { roundId, ms } 或 { roundId, falseStart: true }
 *   round-result  房主 -> 全部：本局判定 { roundId, winner, times }
 *   match-over    房主 -> 全部：整场结束 { winner }
 *   restart       任一方 -> 对方：再来一盘 { matchNumber }
 *   sync-request  客户端 -> 房主：刷新 / 迟到进场，请把当前比分发我
 *   sync          房主 -> 客户端：当前快照
 *
 * 关键约束：两边时钟不同步，协议里不传任何绝对时间戳。delayMs 是相对时长，
 * 每方从自己收到 round 的那一刻起算；反应时间也用本地 performance.now() 量。
 */
export default function ReactionDuel() {
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);
  const opponentSeat: Seat = seat === 0 ? 1 : 0;

  const [snapshot, setSnapshot] = useState<Snapshot>(() => freshSeriesSnapshot(1));
  const snapshotRef = useRef(snapshot);
  /** 已经判定并广播过的局，防止房主重复记分 */
  const settledRef = useRef<string | null>(null);
  /** 房主判定超时的定时器 */
  const settleTimerRef = useRef<number | null>(null);

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const clearSettleTimer = useCallback(() => {
    if (settleTimerRef.current !== null) {
      window.clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  /**
   * 房主：给一局定胜负、记分并广播 round-result / match-over。
   * base 是要判定的那一局的最新快照，由调用方传入，避免读到过期的 state。
   */
  const settleAsHost = useCallback(
    (roundId: string, base: Snapshot, send: DuelApi['send']) => {
      if (settledRef.current === roundId) return;
      if (base.roundId !== roundId || base.phase === 'over') return;

      settledRef.current = roundId;
      clearSettleTimer();

      const outcome = judgeRound(base.results);
      const series = applyOutcome(base.series, outcome);
      const seriesWinner = matchWinner(series);
      const next: Snapshot = {
        ...base,
        series,
        phase: seriesWinner === null ? 'round-result' : 'over',
        outcome,
        seriesWinner,
      };

      setSnapshot(next);
      snapshotRef.current = next;
      send('round-result', {
        roundId,
        winner: outcome.winner,
        times: outcome.times,
        reason: outcome.reason,
      });
      if (seriesWinner !== null) send('match-over', { winner: seriesWinner });
    },
    [clearSettleTimer],
  );

  const duel = useDuel({
    gameId: 'reaction',
    room,
    seat,
    params,
    onMessage: (message, api) => {
      if (message.type === 'sync-request') {
        if (seat === 0) api.send('sync', snapshotRef.current);
        return;
      }

      if (message.type === 'sync') {
        const data = message.data as Snapshot | undefined;
        if (!data || !Array.isArray(data.series) || typeof data.roundId !== 'string') return;
        // 只补比分和局数，不接管本局正在进行的计时
        if (snapshotRef.current.roundId !== '') return;
        setSnapshot((prev) => {
          if (prev.roundId !== '') return prev;
          return {
            ...prev,
            series: data.series,
            matchNumber: typeof data.matchNumber === 'number' ? data.matchNumber : prev.matchNumber,
            round: typeof data.round === 'number' ? data.round : prev.round,
            phase: data.phase === 'over' ? 'over' : prev.phase,
            seriesWinner: data.seriesWinner ?? null,
          };
        });
        return;
      }

      if (message.type === 'round') {
        const data = message.data as
          | { roundId?: unknown; delayMs?: unknown; round?: unknown }
          | undefined;
        const roundId = typeof data?.roundId === 'string' ? data.roundId : '';
        if (!roundId || roundId === snapshotRef.current.roundId) return;

        const delayMs = clampDelayMs(
          typeof data?.delayMs === 'number' ? data.delayMs : randomDelayMs(),
        );
        const round = typeof data?.round === 'number' ? data.round : snapshotRef.current.round + 1;

        clearSettleTimer();
        settledRef.current = null;
        const next: Snapshot = {
          series: snapshotRef.current.series,
          matchNumber: snapshotRef.current.matchNumber,
          round,
          roundId,
          phase: 'waiting',
          goAt: null,
          results: {},
          outcome: null,
          seriesWinner: null,
        };
        setSnapshot(next);
        snapshotRef.current = next;

        // 「点！」从「收到这条消息」的时刻起算，两边各自计时
        window.setTimeout(() => {
          const base = snapshotRef.current;
          if (base.roundId !== roundId || base.phase !== 'waiting') return;
          const going: Snapshot = { ...base, phase: 'go', goAt: performance.now() };
          setSnapshot(going);
          snapshotRef.current = going;
        }, delayMs);
        return;
      }

      if (message.type === 'result') {
        const data = message.data as { roundId?: unknown } | undefined;
        const roundId = typeof data?.roundId === 'string' ? data.roundId : '';
        if (!roundId) return;
        const result = parseRoundResult(message.data);
        if (!result) return;
        const base = snapshotRef.current;
        if (base.roundId !== roundId) return;
        const from: SeatIndex = message.seat === 0 ? 0 : 1;
        const next: Snapshot = { ...base, results: { ...base.results, [from]: result } };
        setSnapshot(next);
        snapshotRef.current = next;
        if (seat === 0 && next.results[0] && next.results[1]) settleAsHost(roundId, next, api.send);
        return;
      }

      if (message.type === 'round-result') {
        const data = parseRoundResultMessage(message.data);
        if (!data || data.roundId !== snapshotRef.current.roundId) return;
        const base = snapshotRef.current;
        const roundOutcome: RoundOutcome = {
          winner: data.winner,
          reason: data.reason,
          times: data.times,
        };
        // 房主自己已经算过并记分了，这里不重复记分
        if (seat === 0) {
          setSnapshot((prev) =>
            prev.roundId === data.roundId ? { ...prev, outcome: roundOutcome } : prev,
          );
          return;
        }
        const series = applyOutcome(base.series, roundOutcome);
        const seriesWinner = matchWinner(series);
        const next: Snapshot = {
          ...base,
          series,
          phase: seriesWinner === null ? 'round-result' : 'over',
          outcome: roundOutcome,
          seriesWinner,
        };
        setSnapshot(next);
        snapshotRef.current = next;
        return;
      }

      if (message.type === 'match-over') {
        const data = parseMatchOver(message.data);
        if (!data) return;
        setSnapshot((prev) =>
          prev.phase === 'over' ? prev : { ...prev, phase: 'over', seriesWinner: data.winner },
        );
        return;
      }

      if (message.type === 'restart') {
        const data = message.data as { matchNumber?: unknown } | undefined;
        const matchNumber =
          typeof data?.matchNumber === 'number'
            ? data.matchNumber
            : snapshotRef.current.matchNumber + 1;
        settledRef.current = null;
        clearSettleTimer();
        const next = freshSeriesSnapshot(matchNumber);
        setSnapshot(next);
        snapshotRef.current = next;
      }
    },
  });

  const { send, isHost, status } = duel;

  // 房主：两名玩家就位后开第一局
  useEffect(() => {
    if (status !== 'ready' || !isHost) return;
    if (snapshotRef.current.phase !== 'idle' || snapshotRef.current.roundId !== '') return;
    const roundId = upcomingRoundId(snapshotRef.current.matchNumber, 1);
    const next: Snapshot = {
      series: emptySeries(),
      matchNumber: snapshotRef.current.matchNumber,
      round: 1,
      roundId,
      phase: 'waiting',
      goAt: null,
      results: {},
      outcome: null,
      seriesWinner: null,
    };
    settledRef.current = null;
    setSnapshot(next);
    snapshotRef.current = next;
    send('round', { roundId, delayMs: randomDelayMs(), round: 1 });
  }, [status, isHost, send]);

  // 客户端：进房间后要一次比分，刷新后也能看到正确的比分
  useEffect(() => {
    if (status !== 'ready' || isHost) return;
    const timer = window.setTimeout(() => send('sync-request'), 700);
    return () => window.clearTimeout(timer);
  }, [status, isHost, send]);

  // 房主：本局结果已出，暂停约 1.5 秒后开下一局
  useEffect(() => {
    if (!isHost || snapshot.phase !== 'round-result' || snapshot.seriesWinner !== null) return;
    const round = snapshot.round + 1;
    const roundId = upcomingRoundId(snapshot.matchNumber, round);
    const delayMs = randomDelayMs();
    const timer = window.setTimeout(() => {
      const base = snapshotRef.current;
      if (base.phase !== 'round-result' || base.roundId === roundId) return;
      const next: Snapshot = {
        series: base.series,
        matchNumber: base.matchNumber,
        round,
        roundId,
        phase: 'waiting',
        goAt: null,
        results: {},
        outcome: null,
        seriesWinner: null,
      };
      settledRef.current = null;
      setSnapshot(next);
      snapshotRef.current = next;
      send('round', { roundId, delayMs, round });
    }, NEXT_ROUND_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [isHost, snapshot.phase, snapshot.round, snapshot.matchNumber, snapshot.seriesWinner, send]);

  // 玩家出手：空格 / 回车 / 点击都走这里
  const press = useCallback(() => {
    const base = snapshotRef.current;
    if (base.roundId === '' || base.phase === 'over' || base.phase === 'round-result') return;

    // 出现「点！」之前按键 = 抢跑，这一局直接判负
    if (base.phase === 'waiting') {
      const next: Snapshot = {
        ...base,
        phase: 'pressed',
        results: { ...base.results, [seat]: { falseStart: true } },
      };
      setSnapshot(next);
      snapshotRef.current = next;
      send('result', { roundId: base.roundId, falseStart: true });
      if (isHost && next.results[0] && next.results[1]) settleAsHost(base.roundId, next, send);
      return;
    }

    if (base.phase !== 'go' || base.goAt === null) return;

    const ms = reactionMs(base.goAt, performance.now());
    if (ms === null) return;
    const next: Snapshot = {
      ...base,
      phase: 'pressed',
      results: { ...base.results, [seat]: { ms } },
    };
    setSnapshot(next);
    snapshotRef.current = next;
    send('result', { roundId: base.roundId, ms });
    if (isHost && next.results[0] && next.results[1]) settleAsHost(base.roundId, next, send);
  }, [isHost, seat, send, settleAsHost]);

  // 房主：出现「点！」后 3 秒内没收到某方结果，就按超时判定并广播
  useEffect(() => {
    if (!isHost || snapshot.phase !== 'go') return;
    const roundId = snapshot.roundId;
    clearSettleTimer();
    settleTimerRef.current = window.setTimeout(() => {
      settleAsHost(roundId, snapshotRef.current, send);
    }, RESULT_TIMEOUT_MS);
    return clearSettleTimer;
  }, [isHost, snapshot.phase, snapshot.roundId, settleAsHost, clearSettleTimer, send]);

  // 键盘：空格 / 回车出手
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.key !== ' ' && event.key !== 'Spacebar' && event.key !== 'Enter') return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      event.preventDefault();
      press();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [press]);

  const restart = () => {
    settledRef.current = null;
    clearSettleTimer();
    const next = freshSeriesSnapshot(snapshotRef.current.matchNumber + 1);
    setSnapshot(next);
    snapshotRef.current = next;
    send('restart', { matchNumber: next.matchNumber });
  };

  const { phase, series, outcome, results, seriesWinner, round } = snapshot;
  const myResult = results[seat];
  const canPress = phase === 'waiting' || phase === 'go';

  /**
   * 双方成绩：本局判定之后用房主广播的权威用时（可能有一方是 null = 超时），
   * 判定之前用本地即时收到的结果。
   */
  const shown: [RoundResult | undefined, RoundResult | undefined] =
    (phase === 'round-result' || phase === 'over') && outcome
      ? [
          outcome.times[0] === null ? { falseStart: true } : { ms: outcome.times[0] },
          outcome.times[1] === null ? { falseStart: true } : { ms: outcome.times[1] },
        ]
      : [results[0], results[1]];

  /** 用时的配色：抢跑红、本局胜者绿、还没出手灰。 */
  const timeClass = (which: Seat): string => {
    const target = shown[which];
    if (target?.falseStart) return ' is-foul';
    if (!target) return ' is-idle';
    if ((phase === 'round-result' || phase === 'over') && outcome?.winner === which) return ' is-fast';
    return '';
  };

  /** 整块色块里的图标 / 大字 / 标题 / 副文案。 */
  const face = (() => {
    switch (phase) {
      case 'waiting':
        return {
          icon: '⚡',
          now: '',
          title: '准备…',
          sub: '看到「点！」再出手，提前按算抢跑。',
        };
      case 'go':
        return { icon: '', now: '点！', title: '', sub: '立刻按空格 / 点击！' };
      case 'pressed':
        return myResult?.falseStart
          ? { icon: '🚫', now: '抢跑！', title: '', sub: '这一局算你输，等对手和房主判定。' }
          : {
              icon: '✅',
              now: '',
              title: '出手了！',
              sub: `你的成绩 ${formatResult(myResult)}，等对手…`,
            };
      case 'round-result': {
        if (!outcome || outcome.winner === null) {
          return {
            icon: '🤝',
            now: '',
            title: '这一局没人得分',
            sub: winnerText(outcome?.reason ?? 'both-timeout'),
          };
        }
        const iWon = outcome.winner === seat;
        return {
          icon: iWon ? '🎉' : '😵',
          now: '',
          title: iWon ? '这一局你赢了' : '这一局对手赢了',
          sub: winnerText(outcome.reason),
        };
      }
      case 'over':
        return seriesWinner === seat
          ? {
              icon: '🏆',
              now: '',
              title: '你赢下了整场！',
              sub: `五局三胜结束，比分 ${series[0]} : ${series[1]}`,
            }
          : {
              icon: '💀',
              now: '',
              title: '对手赢下了整场',
              sub: `五局三胜结束，比分 ${series[0]} : ${series[1]}`,
            };
      case 'idle':
      default:
        return {
          icon: '⏳',
          now: '',
          title: '等待房主开局…',
          sub: '房主发出这一局后屏幕会变色——看到「点！」再出手。',
        };
    }
  })();

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
        <div className="reaction-stage">
          <DuelStatusBar duel={duel} scores={series} unit="胜局" />

          <div className="reaction-round">
            <span>第 {Math.max(round, 1)} 局</span>
            <span>·</span>
            <span>先赢 {WINS_TO_MATCH} 局获胜</span>
            <span>·</span>
            <span>
              等待 {DELAY_MIN_MS / 1000}~{DELAY_MAX_MS / 1000} 秒随机亮灯
            </span>
          </div>

          <div className={`reaction-box ${phaseClass(phase, outcome, seat)}`}>
            <button
              type="button"
              className="reaction-press"
              onClick={press}
              disabled={!canPress}
              aria-label="出手"
            >
              <span className="reaction-sr">出手</span>
            </button>

            {face.icon ? (
              <span className="reaction-icon" aria-hidden="true">
                {face.icon}
              </span>
            ) : null}
            {face.now ? <strong className="reaction-now">{face.now}</strong> : null}
            {face.title ? <strong className="reaction-title">{face.title}</strong> : null}
            {face.sub ? <span className="reaction-sub">{face.sub}</span> : null}

            {phase === 'waiting' ? (
              <span className="reaction-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </span>
            ) : null}
          </div>

          <div className="reaction-times">
            <div className={`reaction-time${timeClass(seat)}`}>
              <span>你</span>
              <strong>{formatResult(shown[seat])}</strong>
            </div>
            <div className={`reaction-time${timeClass(opponentSeat)}`}>
              <span>对手</span>
              <strong>{formatResult(shown[opponentSeat])}</strong>
            </div>
          </div>

          {phase === 'round-result' && outcome ? (
            <p
              className={`reaction-banner${
                outcome.winner === null ? '' : outcome.winner === seat ? ' is-win' : ' is-lose'
              }`}
            >
              第 {round} 局：
              {outcome.winner === null
                ? winnerText(outcome.reason)
                : outcome.winner === seat
                  ? `你 ${formatResult(shown[seat])} / 对手 ${formatResult(shown[opponentSeat])}，你拿下这一局`
                  : `对手 ${formatResult(shown[opponentSeat])} / 你 ${formatResult(shown[seat])}，对手拿下这一局`}
            </p>
          ) : null}

          {phase === 'over' ? (
            <>
              <p className={`reaction-final${seriesWinner === seat ? ' is-win' : ' is-lose'}`}>
                {seriesWinner === seat ? '🏆 你赢了整场' : '💀 对手赢了整场'} · {series[0]} : {series[1]}
              </p>
              <div className="reaction-actions">
                <button type="button" className="btn btn-primary" onClick={restart}>
                  再来一盘
                </button>
              </div>
              <p className="reaction-wait">
                点「再来一盘」后由房主重开，双方都回到 0 : 0；对手也点一下会更快。
              </p>
            </>
          ) : null}

          {phase === 'waiting' || phase === 'go' ? (
            <p className="reaction-hint">空格 / 回车 / 点击都可以出手</p>
          ) : null}
        </div>
      )}
    </GameFrame>
  );
}
