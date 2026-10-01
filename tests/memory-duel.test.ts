/**
 * 记忆翻牌对战逻辑的单元测试。
 * 运行方式：node --test tests/memory-duel.test.ts
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyFlip,
  BOARD_SIZE,
  canFlip,
  canSettle,
  createDeck,
  evaluate,
  freshRound,
  isMyTurn,
  isRevealed,
  mismatchPending,
  other,
  PAIRS,
  parseState,
  settle,
  type Emoji,
  type State,
} from '../src/games/online/memory-duel/logic.ts';
import type { Seat } from '../src/lib/net/types.ts';

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function stateOf(partial: Partial<State> & { deck: Emoji[] }): State {
  return {
    flipped: [],
    matched: [],
    turn: 0,
    scores: [0, 0],
    round: 0,
    ...partial,
  };
}

/** 找出 deck 里某个 emoji 出现的所有位置。 */
function spots(deck: Emoji[], emoji: Emoji): number[] {
  const found: number[] = [];
  deck.forEach((card, index) => {
    if (card === emoji) found.push(index);
  });
  return found;
}

/** 取一对同款牌的位置。 */
function pairOf(deck: Emoji[]): [number, number] {
  for (const emoji of deck) {
    const found = spots(deck, emoji);
    if (found.length === 2) return [found[0]!, found[1]!];
  }
  throw new Error('牌阵里没有成对的牌');
}

/** 取一张和 `index` 不同款的牌的位置（保证凑不出配对）。 */
function missOf(deck: Emoji[], index: number): number {
  const found = deck.findIndex((card) => card !== deck[index]);
  assert.ok(found >= 0, '牌阵里应该存在不同款的牌');
  return found;
}

/** 造一副没配过任何牌的确定状态。 */
function freshDeckState(turn: Seat = 0): State {
  return stateOf({ deck: createDeck(2024), turn });
}

/* ------------------------------------------------------------------ */
/* 洗牌：确定性与牌面分布                                              */
/* ------------------------------------------------------------------ */

test('洗牌：同一个种子得到完全相同的牌阵', () => {
  const first = createDeck(12345);
  const second = createDeck(12345);
  assert.deepEqual(first, second, '同种子必须同牌阵');
  assert.equal(first.length, BOARD_SIZE);
});

test('洗牌：不同种子（通常）得到不同牌阵', () => {
  const seen = new Set<string>();
  for (let seed = 0; seed < 20; seed += 1) {
    seen.add(createDeck(seed).join(''));
  }
  assert.ok(seen.size > 1, '不同种子不应该每次都摆出同一个牌阵');
});

test('洗牌：16 张牌恰好是 8 对，且全部来自牌面池', () => {
  const deck = createDeck(777);
  assert.equal(deck.length, BOARD_SIZE);

  const counts = new Map<Emoji, number>();
  for (const emoji of deck) counts.set(emoji, (counts.get(emoji) ?? 0) + 1);

  assert.equal(counts.size, PAIRS, '应该正好用到 8 种牌面');
  for (const [emoji, count] of counts) {
    assert.equal(count, 2, `${emoji} 应该恰好出现两次`);
  }
});

test('洗牌：给定牌面池只有 8 种时，洗牌结果包含全部 8 种', () => {
  const pool = ['🍎', '🍇', '🍉', '🍋', '🥑', '🍒', '🍑', '🥝'];
  const deck = createDeck(99, pool);
  assert.deepEqual([...new Set(deck)].sort(), [...pool].sort());
  assert.equal(deck.length, BOARD_SIZE);
});

test('洗牌：牌面池不足 8 种时直接报错', () => {
  assert.throws(() => createDeck(1, ['🍎', '🍇']), /至少需要 8 个/);
});

/* ------------------------------------------------------------------ */
/* 开局                                                                */
/* ------------------------------------------------------------------ */

test('开局：第 0 局玩家 1 先手，第 1 局玩家 2 先手，交替进行', () => {
  assert.equal(freshRound(0, [0, 0]).turn, 0);
  assert.equal(freshRound(1, [0, 0]).turn, 1);
  assert.equal(freshRound(2, [0, 0]).turn, 0);
  assert.equal(freshRound(3, [0, 0]).turn, 1);
});

test('开局：新一局保留累计比分，桌面清空', () => {
  const round = freshRound(1, [3, 2], 42);
  assert.deepEqual(round.scores, [3, 2]);
  assert.equal(round.round, 1);
  assert.deepEqual(round.flipped, []);
  assert.deepEqual(round.matched, []);
  assert.equal(round.deck.length, BOARD_SIZE);
});

test('座位：other 双向对称，isMyTurn 只看当前回合', () => {
  assert.equal(other(0), 1);
  assert.equal(other(1), 0);
  assert.equal(other(other(0)), 0);

  const state = freshDeckState(0);
  assert.equal(isMyTurn(state, 0), true);
  assert.equal(isMyTurn(state, 1), false);

  const over = stateOf({ deck: createDeck(5), matched: Array.from({ length: BOARD_SIZE }, (_, index) => index), scores: [8, 0] });
  assert.equal(isMyTurn(over, 0), false, '对局结束后不再有「轮到你」');
});

/* ------------------------------------------------------------------ */
/* 翻牌：翻一张 / 配对成功 / 配对失败                                  */
/* ------------------------------------------------------------------ */

test('翻牌：翻第一张只记录下来，不换手、不加分', () => {
  const state = freshDeckState(0);
  const next = applyFlip(state, 0, 3);

  assert.notEqual(next, state, '合法翻牌应返回新对象');
  assert.deepEqual(next.flipped, [3]);
  assert.equal(next.turn, 0);
  assert.deepEqual(next.scores, [0, 0]);
  assert.deepEqual(state.flipped, [], '原状态不应被修改');
});

test('翻牌：配对成功加 1 分并继续自己的回合', () => {
  const deck = createDeck(2024);
  const [a, b] = pairOf(deck);
  const state = stateOf({ deck });

  const one = applyFlip(state, 0, a);
  const two = applyFlip(one, 0, b);

  assert.deepEqual(two.matched.slice().sort((x, y) => x - y), [a, b].sort((x, y) => x - y));
  assert.deepEqual(two.flipped, []);
  assert.deepEqual(two.scores, [1, 0]);
  assert.equal(two.turn, 0, '配对成功继续翻，回合不变');
  assert.equal(mismatchPending(two), false);
});

test('翻牌：玩家 2 配对成功记在玩家 2 头上', () => {
  const deck = createDeck(2024);
  const [a, b] = pairOf(deck);
  const state = stateOf({ deck, turn: 1 });

  const next = applyFlip(applyFlip(state, 1, a), 1, b);
  assert.deepEqual(next.scores, [0, 1]);
  assert.equal(next.turn, 1);
});

test('翻牌：配对失败不换手也不加分，等定时器翻回', () => {
  const deck = createDeck(2024);
  const a = 0;
  const b = missOf(deck, a);
  const state = stateOf({ deck });

  const one = applyFlip(state, 0, a);
  const two = applyFlip(one, 0, b);

  assert.equal(two.turn, 0, '翻回之前回合先不动');
  assert.deepEqual(two.scores, [0, 0]);
  assert.deepEqual(two.matched, []);
  assert.deepEqual(two.flipped, [a, b]);
  assert.equal(mismatchPending(two), true, '桌上摆着两张配不上的牌');
});

test('翻牌：两张相同的牌判定为配对，不会因为牌面相同而误判', () => {
  const deck = ['🍎', '🍎', ...Array.from({ length: BOARD_SIZE - 2 }, (_, index) => `x${index}`)];
  const next = applyFlip(applyFlip(stateOf({ deck }), 0, 0), 0, 1);
  assert.deepEqual(next.scores, [1, 0]);
  assert.deepEqual(next.matched.slice().sort((x, y) => x - y), [0, 1]);
});

/* ------------------------------------------------------------------ */
/* 非法操作                                                            */
/* ------------------------------------------------------------------ */

test('非法翻牌：不是自己回合时原样返回同一个引用', () => {
  const state = freshDeckState(0);
  assert.equal(applyFlip(state, 1, 0), state, '玩家 2 不能在玩家 1 的回合翻牌');
  assert.equal(canFlip(state, 1, 0), false);
  assert.equal(canFlip(state, 0, 0), true);
});

test('非法翻牌：越界、小数、已翻开、已配对都被拒绝', () => {
  const state = stateOf({ deck: createDeck(2024), flipped: [2], matched: [5, 6] });

  assert.equal(applyFlip(state, 0, -1), state);
  assert.equal(applyFlip(state, 0, BOARD_SIZE), state);
  assert.equal(applyFlip(state, 0, 1.5), state);
  assert.equal(applyFlip(state, 0, 2), state, '同一张牌不能翻两次');
  assert.equal(applyFlip(state, 0, 5), state, '已配对的牌不能翻');
  assert.equal(canFlip(state, 0, 7), true);
});

test('非法翻牌：两张配不上的牌摊着时，谁都不能再翻第三张', () => {
  const deck = createDeck(2024);
  const a = 0;
  const b = missOf(deck, a);
  const pending = applyFlip(applyFlip(stateOf({ deck }), 0, a), 0, b);

  assert.equal(canFlip(pending, 0, missOf(deck, b)), false);
  assert.equal(canFlip(pending, 1, missOf(deck, b)), false);
  assert.equal(applyFlip(pending, 0, missOf(deck, b)), pending);
});

/* ------------------------------------------------------------------ */
/* 翻回                                                                */
/* ------------------------------------------------------------------ */

test('翻回：收走两张明牌并把回合交给对方', () => {
  const deck = createDeck(2024);
  const a = 0;
  const b = missOf(deck, a);
  const pending = applyFlip(applyFlip(stateOf({ deck }), 0, a), 0, b);

  assert.equal(canSettle(pending), true);
  const after = settle(pending);

  assert.deepEqual(after.flipped, [], '两张牌应该翻回去');
  assert.equal(after.turn, 1, '回合交给对方');
  assert.deepEqual(after.scores, [0, 0]);
  assert.equal(mismatchPending(after), false);
  assert.equal(pending.flipped.length, 2, '原状态不应被修改');
});

test('翻回：翻回之后对方可以接着翻牌', () => {
  const deck = createDeck(2024);
  const a = 0;
  const b = missOf(deck, a);
  const after = settle(applyFlip(applyFlip(stateOf({ deck }), 0, a), 0, b));

  assert.equal(canFlip(after, 1, a), true, '翻回去的牌可以重新翻');
  assert.equal(canFlip(after, 0, a), false, '现在轮到玩家 2');
});

test('翻回：配对成功或牌张不足时不能翻回', () => {
  const deck = createDeck(2024);
  const [a, b] = pairOf(deck);
  const matched = applyFlip(applyFlip(stateOf({ deck }), 0, a), 0, b);
  assert.equal(canSettle(matched), false);
  assert.equal(settle(matched), matched, '不合法时原样返回同一引用');

  const single = applyFlip(stateOf({ deck }), 0, a);
  assert.equal(canSettle(single), false);
  assert.equal(settle(single), single);
});

/* ------------------------------------------------------------------ */
/* 胜负判定                                                            */
/* ------------------------------------------------------------------ */

test('胜负：没配完就算还在进行', () => {
  const state = stateOf({ deck: createDeck(11), matched: [0, 1], scores: [1, 0] });
  assert.deepEqual(evaluate(state), { kind: 'playing' });
});

test('胜负：全部配对后分高者胜', () => {
  const all = Array.from({ length: BOARD_SIZE }, (_, index) => index);

  assert.deepEqual(evaluate(stateOf({ deck: createDeck(11), matched: all, scores: [5, 3] })), {
    kind: 'over',
    winner: 0,
  });
  assert.deepEqual(evaluate(stateOf({ deck: createDeck(11), matched: all, scores: [2, 6] })), {
    kind: 'over',
    winner: 1,
  });
});

test('胜负：比分相同算平局', () => {
  const all = Array.from({ length: BOARD_SIZE }, (_, index) => index);
  assert.deepEqual(evaluate(stateOf({ deck: createDeck(11), matched: all, scores: [4, 4] })), {
    kind: 'over',
    winner: null,
  });
  assert.deepEqual(evaluate(stateOf({ deck: createDeck(11), matched: all, scores: [0, 0] })), {
    kind: 'over',
    winner: null,
  });
});

/* ------------------------------------------------------------------ */
/* 两端一致性：同一个动作序列算出同一个结果                            */
/* ------------------------------------------------------------------ */

test('确定性：两端各自应用同一串翻牌动作，得到完全一样的状态', () => {
  const deck = createDeck(31337);
  const pair = pairOf(deck);
  // 再找两张都还没被翻过的、又配不成对的牌
  const missA = deck.findIndex((_, index) => !pair.includes(index));
  const missB = deck.findIndex((card, index) => index !== missA && card !== deck[missA] && !pair.includes(index));
  assert.ok(missA >= 0 && missB >= 0, '应该能找到两张配不上的牌');

  const actions: Array<{ seat: Seat; index: number }> = [
    { seat: 0, index: pair[0]! },
    { seat: 0, index: pair[1]! }, // 玩家 1 配对成功，继续翻
    { seat: 0, index: missA },
    { seat: 0, index: missB }, // 玩家 1 翻错 -> 等一下翻回、换手
    { seat: 1, index: missA },
    { seat: 1, index: missB }, // 玩家 2 翻同样两张，合法
  ];

  // 客户端 A：一口气按顺序应用（中间不 settle），最后才翻回
  let left = stateOf({ deck });
  for (const action of actions.slice(0, 4)) {
    left = applyFlip(left, action.seat, action.index);
  }
  // 后两条是「对手的动作」，A 端也会照做
  assert.equal(left.flipped.length, 2, '两张配不上的牌摊在桌上');
  assert.equal(mismatchPending(left), true);
  left = settle(left);
  // 换手后玩家 2 翻同样两张（也配不上）
  left = applyFlip(left, actions[4]!.seat, actions[4]!.index);
  left = applyFlip(left, actions[5]!.seat, actions[5]!.index);
  assert.equal(mismatchPending(left), true);
  left = settle(left);

  // 客户端 B：同样的动作逐条应用，翻错时立刻翻回，最终状态必须一致
  let right = stateOf({ deck });
  for (const action of actions) {
    const next = applyFlip(right, action.seat, action.index);
    if (next !== right) right = next;
    if (mismatchPending(right)) right = settle(right);
  }

  assert.deepEqual(right.deck, left.deck);
  assert.deepEqual(right.matched, left.matched);
  assert.deepEqual(right.flipped, left.flipped);
  assert.deepEqual(right.scores, left.scores);
  assert.equal(right.turn, left.turn);
  assert.deepEqual(right.scores, [1, 0], '玩家 1 配成一对，玩家 2 一张没配上');
  assert.equal(right.turn, 0, '两次翻错各换手一次：玩家 1 -> 玩家 2 -> 玩家 1');
  assert.deepEqual(right.matched.slice().sort((x, y) => x - y), [...pair].sort((x, y) => x - y));
});

/* ------------------------------------------------------------------ */
/* 网络快照校验                                                        */
/* ------------------------------------------------------------------ */

test('快照校验：合法快照原样接受（并复制数组）', () => {
  const state = stateOf({ deck: createDeck(8), flipped: [1], matched: [2, 3], scores: [1, 0], turn: 1, round: 2 });
  const parsed = parseState(state);

  assert.ok(parsed);
  assert.deepEqual(parsed, state);
  assert.notEqual(parsed.deck, state.deck, '应复制数组，避免共享引用');
});

test('快照校验：形状不对的快照一律拒绝', () => {
  const good = stateOf({ deck: createDeck(8) });

  assert.equal(parseState(null), null);
  assert.equal(parseState(undefined), null);
  assert.equal(parseState('nope'), null);
  assert.equal(parseState([]), null);
  assert.equal(parseState({}), null);
  assert.equal(parseState({ ...good, deck: good.deck.slice(0, 15) }), null, '牌数不对');
  assert.equal(parseState({ ...good, deck: [1, ...good.deck.slice(1)] }), null, '牌面必须是字符串');
  assert.equal(parseState({ ...good, flipped: [0, 1, 2] }), null, '最多两张明牌');
  assert.equal(parseState({ ...good, flipped: [-1] }), null);
  assert.equal(parseState({ ...good, matched: [99] }), null);
  assert.equal(parseState({ ...good, scores: [1] }), null);
  assert.equal(parseState({ ...good, scores: [1, 'x'] }), null);
  assert.equal(parseState({ ...good, turn: 2 }), null);
  assert.equal(parseState({ ...good, round: 'a' }), null);
});

test('可见状态：isRevealed 同时覆盖已配对与正翻开', () => {
  const state = stateOf({ deck: createDeck(8), flipped: [1], matched: [2, 3] });
  assert.equal(isRevealed(state, 1), true);
  assert.equal(isRevealed(state, 2), true);
  assert.equal(isRevealed(state, 3), true);
  assert.equal(isRevealed(state, 4), false);
});
