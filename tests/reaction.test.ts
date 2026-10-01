/**
 * 抢答反应对决纯逻辑的单元测试。
 *
 * 运行方式（Node 24 直接执行 .ts）：
 *   node --test tests/reaction.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DELAY_MAX_MS,
  DELAY_MIN_MS,
  MAX_PLAUSIBLE_MS,
  MIN_PLAUSIBLE_MS,
  RESULT_TIMEOUT_MS,
  ROUNDS_TO_MATCH,
  WINS_TO_MATCH,
  addWin,
  applyOutcome,
  clampDelayMs,
  emptySeries,
  formatMs,
  formatResult,
  isFalseStart,
  isValidMs,
  judgeRound,
  matchWinner,
  nextRoundOrdinal,
  parseMatchOver,
  parseRoundResult,
  parseRoundResultMessage,
  parseReason,
  reactionMs,
  roundsUpperBound,
  timeForSeat,
  timesFor,
  timesFrom,
  upcomingRoundId,
  winnerText,
  type RoundOutcome,
  type Series,
} from '../src/games/online/reaction/logic.ts';

// ---------------------------------------------------------------------------
// 计时 / 抢跑
// ---------------------------------------------------------------------------

test('反应计时：用相对时间量出毫秒，不依赖墙上时钟', () => {
  const goAt = 1234.5;
  assert.equal(reactionMs(goAt, goAt), 0, '同一时刻出手算 0ms');
  assert.equal(reactionMs(goAt, goAt + 320.4), 320, '四舍五入到整数毫秒');
  assert.equal(reactionMs(1000, 1000 + MAX_PLAUSIBLE_MS), MAX_PLAUSIBLE_MS);

  // 两边的 performance.now() 原点完全不同也没关系：只看差值
  const otherClockGo = 987_654_321.75;
  assert.equal(reactionMs(otherClockGo, otherClockGo + 250), 250);
});

test('抢跑判定：出手早于「点！」出现就是抢跑', () => {
  assert.equal(isFalseStart(1000, 999), true);
  assert.equal(isFalseStart(1000, 1000), false, '正好同一时刻不算抢跑');
  assert.equal(isFalseStart(1000, 1001), false);
  assert.equal(reactionMs(1000, 999), null, '抢跑量不出成绩');

  // 非有限数不参与判定，避免 NaN 污染整局
  assert.equal(isFalseStart(Number.NaN, 5), false);
  assert.equal(reactionMs(Number.POSITIVE_INFINITY, 5), null);
});

// ---------------------------------------------------------------------------
// 消息校验
// ---------------------------------------------------------------------------

test('校验 result：正常成绩、抢跑、以及垃圾数据', () => {
  assert.deepEqual(parseRoundResult({ roundId: 'm1r1', ms: 321.6 }), { ms: 322 });
  assert.deepEqual(parseRoundResult({ ms: MIN_PLAUSIBLE_MS }), { ms: MIN_PLAUSIBLE_MS });
  assert.deepEqual(parseRoundResult({ falseStart: true }), { falseStart: true });
  assert.deepEqual(parseRoundResult({ ms: 300, falseStart: false }), { ms: 300 });

  // 抢跑优先：即使带了 ms 也按抢跑处理
  assert.deepEqual(parseRoundResult({ ms: 300, falseStart: true }), { falseStart: true });

  assert.equal(parseRoundResult(null), null);
  assert.equal(parseRoundResult(undefined), null);
  assert.equal(parseRoundResult('320'), null);
  assert.equal(parseRoundResult({}), null, '既没成绩也没抢跑标记');
  assert.equal(parseRoundResult({ ms: '320' }), null);
  assert.equal(parseRoundResult({ ms: Number.NaN }), null);
  assert.equal(parseRoundResult({ ms: -5 }), null, '负数不可能');
  assert.equal(parseRoundResult({ ms: MIN_PLAUSIBLE_MS - 1 }), null, '比人还快，当成异常');
  assert.equal(parseRoundResult({ ms: MAX_PLAUSIBLE_MS + 1 }), null, '超出上限，当成超时');
  assert.equal(parseRoundResult({ falseStart: 'yes' }), null);
});

test('校验毫秒合法性', () => {
  assert.equal(isValidMs(200), true);
  assert.equal(isValidMs(MIN_PLAUSIBLE_MS), true);
  assert.equal(isValidMs(MAX_PLAUSIBLE_MS), true);
  assert.equal(isValidMs(MIN_PLAUSIBLE_MS - 1), false);
  assert.equal(isValidMs(MAX_PLAUSIBLE_MS + 1), false);
  assert.equal(isValidMs(Number.NaN), false);
  assert.equal(isValidMs('200'), false);
  assert.equal(isValidMs(null), false);
});

test('校验 round-result：房主广播的结果包', () => {
  assert.deepEqual(parseRoundResultMessage({ roundId: 'm1r1', winner: 0, times: [280, 320] }), {
    roundId: 'm1r1',
    winner: 0,
    times: [280, 320],
    reason: 'fastest',
  });
  assert.deepEqual(
    parseRoundResultMessage({ roundId: 'm1r2', winner: null, times: [null, null], reason: 'both-timeout' }),
    { roundId: 'm1r2', winner: null, times: [null, null], reason: 'both-timeout' },
  );
  // 缺 times 时补成 [null, null]
  assert.deepEqual(parseRoundResultMessage({ roundId: 'm1r3', winner: 1 }), {
    roundId: 'm1r3',
    winner: 1,
    times: [null, null],
    reason: 'fastest',
  });
  // 小数会被取整
  assert.deepEqual(parseRoundResultMessage({ roundId: 'm1r4', winner: 0, times: [280.6, 320.2] }), {
    roundId: 'm1r4',
    winner: 0,
    times: [281, 320],
    reason: 'fastest',
  });

  assert.equal(parseRoundResultMessage(null), null);
  assert.equal(parseRoundResultMessage({ winner: 0 }), null, '没有 roundId');
  assert.equal(parseRoundResultMessage({ roundId: '', winner: 0 }), null);
  assert.equal(parseRoundResultMessage({ roundId: 'm1r1', winner: 7 }), null);
});

test('校验 reason：认不出来就退回「比反应」', () => {
  assert.equal(parseReason('timeout'), 'timeout');
  assert.equal(parseReason('false-start'), 'false-start');
  assert.equal(parseReason('both-false-start'), 'both-false-start');
  assert.equal(parseReason('whatever'), 'fastest');
  assert.equal(parseReason(undefined), 'fastest');
  assert.equal(parseReason(3), 'fastest');
});

test('校验 match-over：只认 0 / 1 号座位', () => {
  assert.deepEqual(parseMatchOver({ winner: 0 }), { winner: 0 });
  assert.deepEqual(parseMatchOver({ winner: 1 }), { winner: 1 });
  assert.equal(parseMatchOver({ winner: 2 }), null);
  assert.equal(parseMatchOver({}), null);
  assert.equal(parseMatchOver(undefined), null);
});

// ---------------------------------------------------------------------------
// 单局判定
// ---------------------------------------------------------------------------

test('单局判定：两人都正常出手，快的赢', () => {
  const quickSelf = judgeRound({ 0: { ms: 280 }, 1: { ms: 320 } });
  assert.deepEqual(quickSelf, { winner: 0, reason: 'fastest', times: [280, 320] } satisfies RoundOutcome);

  const quickOpponent = judgeRound({ 0: { ms: 400 }, 1: { ms: 210 } });
  assert.equal(quickOpponent.winner, 1);
  assert.deepEqual(quickOpponent.times, [400, 210]);
  assert.equal(quickOpponent.reason, 'fastest');
});

test('单局判定：两边同时出手算平，没有人得分', () => {
  const outcome = judgeRound({ 0: { ms: 300 }, 1: { ms: 300 } });
  assert.equal(outcome.winner, null);
  assert.deepEqual(outcome.times, [300, 300]);
});

test('单局判定：抢跑直接判负', () => {
  const hostJumped = judgeRound({ 0: { falseStart: true }, 1: { ms: 250 } });
  assert.equal(hostJumped.winner, 1);
  assert.equal(hostJumped.reason, 'false-start');

  const guestJumped = judgeRound({ 0: { ms: 250 }, 1: { falseStart: true } });
  assert.equal(guestJumped.winner, 0);
  assert.equal(guestJumped.reason, 'false-start');

  // 抢跑者即使另有成绩也判负
  const jumpedWithTime = judgeRound({ 0: { falseStart: true, ms: 200 }, 1: { ms: 250 } });
  assert.equal(jumpedWithTime.winner, 1);

  // 两个人都抢跑：这一局没人得分
  const bothJumped = judgeRound({ 0: { falseStart: true }, 1: { falseStart: true } });
  assert.equal(bothJumped.winner, null);
  assert.equal(bothJumped.reason, 'both-false-start');
  assert.deepEqual(bothJumped.times, [null, null]);
});

test('单局判定：一边超时（3 秒后没有任何结果）判负', () => {
  const hostMissing = judgeRound({ 1: { ms: 260 } });
  assert.equal(hostMissing.winner, 1);
  assert.equal(hostMissing.reason, 'timeout');

  const guestMissing = judgeRound({ 0: { ms: 260 } });
  assert.equal(guestMissing.winner, 0);
  assert.equal(guestMissing.reason, 'timeout');

  // 抢跑的一方遇到对面超时：抢跑优先，仍然是抢跑者输
  const jumpedAndTimeout = judgeRound({ 0: { falseStart: true } });
  assert.equal(jumpedAndTimeout.winner, 1);
  assert.equal(jumpedAndTimeout.reason, 'false-start');

  // 两个人都没结果
  const nobody = judgeRound({});
  assert.equal(nobody.winner, null);
  assert.equal(nobody.reason, 'both-timeout');
});

test('单局判定：异常毫秒按超时处理，而不是当成成绩', () => {
  const outcome = judgeRound({ 0: { ms: Number.NaN }, 1: { ms: MAX_PLAUSIBLE_MS + 1 } });
  assert.equal(outcome.winner, null);
  assert.equal(outcome.reason, 'both-timeout');
});

test('单局用时提取与文案', () => {
  assert.deepEqual(timesFrom({ 0: { ms: 280.6 }, 1: { falseStart: true } }), [281, null]);
  assert.deepEqual(timesFrom({}), [null, null]);

  assert.equal(timeForSeat([280, 320], 0), 280);
  assert.equal(timeForSeat([280, 320], 1), 320);
  assert.equal(timeForSeat([null, 320], 0), null);

  assert.deepEqual(timesFor([280, 320], 0), { winnerTime: 280, loserTime: 320 });
  assert.deepEqual(timesFor([280, 320], 1), { winnerTime: 320, loserTime: 280 });
  assert.deepEqual(timesFor([280, 320], null), { winnerTime: null, loserTime: null });

  assert.match(winnerText('fastest'), /反应更快/);
  assert.match(winnerText('false-start'), /抢跑/);
  assert.match(winnerText('both-timeout'), /没人得分/);
});

test('成绩格式化', () => {
  assert.equal(formatMs(320.4), '320ms');
  assert.equal(formatMs(0), '0ms');
  assert.equal(formatMs(null), '—');
  assert.equal(formatMs(undefined), '—');
  assert.equal(formatMs(Number.NaN), '—');

  assert.equal(formatResult({ ms: 280 }), '280ms');
  assert.equal(formatResult({ falseStart: true }), '抢跑');
  assert.equal(formatResult(undefined), '—');
});

// ---------------------------------------------------------------------------
// 系列赛
// ---------------------------------------------------------------------------

test('系列赛：五局三胜的比分推进与终局判定', () => {
  let series: Series = emptySeries();
  assert.equal(WINS_TO_MATCH, 3, '先赢 3 局');
  assert.equal(ROUNDS_TO_MATCH, 5, '最多打 5 局');
  assert.equal(roundsUpperBound(), ROUNDS_TO_MATCH);
  assert.deepEqual(series, [0, 0]);
  assert.equal(matchWinner(series), null);
  assert.equal(nextRoundOrdinal(series), 1);

  // 第 1 局：玩家 1 赢
  series = applyOutcome(series, judgeRound({ 0: { ms: 250 }, 1: { ms: 300 } }));
  assert.deepEqual(series, [1, 0]);
  assert.equal(nextRoundOrdinal(series), 2);
  assert.equal(matchWinner(series), null);

  // 第 2 局：玩家 2 赢
  series = applyOutcome(series, judgeRound({ 0: { ms: 400 }, 1: { ms: 260 } }));
  assert.deepEqual(series, [1, 1]);

  // 第 3 局：玩家 1 抢跑 -> 玩家 2 拿分
  series = applyOutcome(series, judgeRound({ 0: { falseStart: true }, 1: { ms: 600 } }));
  assert.deepEqual(series, [1, 2]);
  assert.equal(matchWinner(series), null, '2 胜还不够');

  // 第 4 局：玩家 1 赢，2:2
  series = applyOutcome(series, judgeRound({ 0: { ms: 199 }, 1: { ms: 202 } }));
  assert.deepEqual(series, [2, 2]);
  assert.equal(matchWinner(series), null);

  // 第 5 局：玩家 1 赢下整场
  series = applyOutcome(series, judgeRound({ 0: { ms: 180 }, 1: { ms: 240 } }));
  assert.deepEqual(series, [3, 2]);
  assert.equal(matchWinner(series), 0);
});

test('系列赛：平局 / 双方抢跑不加分，也不会卡住流程', () => {
  const start: Series = [1, 1];
  assert.deepEqual(applyOutcome(start, judgeRound({})), [1, 1]);
  assert.deepEqual(applyOutcome(start, judgeRound({ 0: { falseStart: true }, 1: { falseStart: true } })), [1, 1]);
  assert.deepEqual(applyOutcome(start, judgeRound({ 0: { ms: 300 }, 1: { ms: 300 } })), [1, 1]);
  assert.deepEqual(start, [1, 1], '原比分不应被修改');
});

test('系列赛：addWin 不修改原数组，先到 3 胜即终止', () => {
  const base: Series = [2, 0];
  const after = addWin(base, 0);
  assert.deepEqual(base, [2, 0]);
  assert.deepEqual(after, [3, 0]);
  assert.equal(matchWinner(after), 0);
  assert.equal(matchWinner([0, 3]), 1);
  assert.equal(matchWinner([2, 2]), null);
});

// ---------------------------------------------------------------------------
// 轮次 id / 随机等待
// ---------------------------------------------------------------------------

test('轮次 id 唯一，便于丢弃上一局的迟到消息', () => {
  const first = upcomingRoundId(1, 1);
  assert.equal(first, 'm1r1');
  assert.notEqual(first, upcomingRoundId(1, 2));
  assert.notEqual(upcomingRoundId(1, 1), upcomingRoundId(2, 1));
  assert.notEqual(upcomingRoundId(2, 1), upcomingRoundId(2, 2));
});

test('随机等待被夹在 900~3500ms 之间', () => {
  assert.equal(DELAY_MIN_MS, 900);
  assert.equal(DELAY_MAX_MS, 3500);
  assert.equal(RESULT_TIMEOUT_MS, 3000);

  assert.equal(clampDelayMs(0), DELAY_MIN_MS);
  assert.equal(clampDelayMs(50), DELAY_MIN_MS);
  assert.equal(clampDelayMs(10_000), DELAY_MAX_MS);
  assert.equal(clampDelayMs(1234.6), 1235);
  assert.equal(clampDelayMs(Number.NaN), DELAY_MIN_MS);
});
