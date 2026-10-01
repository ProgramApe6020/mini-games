import { useCallback, useEffect, useRef, useState } from 'react';
import GameFrame from '../components/GameFrame';
import { useBestScore } from '../lib/storage';
import { getGame } from './registry';

const game = getGame('memory')!;

const EMOJIS = ['🍎', '🍇', '🍉', '🍋', '🥑', '🍒', '🍑', '🥝', '🍍', '🌽', '🍄', '🫐'];

type Level = { pairs: number; label: string; cols: number };

const LEVELS: Level[] = [
  { pairs: 6, label: '轻松 4×3', cols: 4 },
  { pairs: 8, label: '标准 4×4', cols: 4 },
  { pairs: 10, label: '挑战 5×4', cols: 5 },
];

type Card = { id: number; emoji: string; matched: boolean };
type Phase = 'ready' | 'running' | 'won';

function shuffledDeck(pairs: number): Card[] {
  const picked = [...EMOJIS].sort(() => Math.random() - 0.5).slice(0, pairs);
  const deck: Card[] = [...picked, ...picked].map((emoji, index) => ({
    id: index,
    emoji,
    matched: false,
  }));

  // Fisher-Yates 洗牌
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
  }
  return deck;
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function Memory() {
  const [levelIndex, setLevelIndex] = useState(0);
  const level = LEVELS[levelIndex]!;

  const [cards, setCards] = useState<Card[]>(() => shuffledDeck(LEVELS[0]!.pairs));
  const [open, setOpen] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [record, setRecord] = useState(false);

  const [best, submitBest] = useBestScore(`memory-${level.pairs}`, 'min');

  const busyRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);

  const clearPendingTimeout = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const resetBoard = useCallback(
    (index: number) => {
      clearPendingTimeout();
      busyRef.current = false;
      const next = LEVELS[index]!;
      setCards(shuffledDeck(next.pairs));
      setOpen([]);
      setMoves(0);
      setSeconds(0);
      setPhase('ready');
      setRecord(false);
    },
    [clearPendingTimeout],
  );

  const changeLevel = (index: number) => {
    setLevelIndex(index);
    resetBoard(index);
  };

  // 计时：只在游戏进行中累加
  useEffect(() => {
    if (phase !== 'running') return;
    const id = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // 卸载时清掉待执行的翻回定时器
  useEffect(() => clearPendingTimeout, [clearPendingTimeout]);

  const flip = (card: Card) => {
    if (phase === 'won' || busyRef.current || card.matched || open.includes(card.id)) return;
    if (phase === 'ready') setPhase('running');

    const next = [...open, card.id];
    setOpen(next);
    if (next.length < 2) return;

    const first = cards.find((item) => item.id === next[0]!);
    const second = cards.find((item) => item.id === next[1]!);
    const usedMoves = moves + 1;
    setMoves(usedMoves);
    if (!first || !second) return;

    if (first.emoji === second.emoji) {
      const nextCards = cards.map((item) =>
        item.id === first.id || item.id === second.id ? { ...item, matched: true } : item,
      );
      setCards(nextCards);
      setOpen([]);
      if (nextCards.every((item) => item.matched)) {
        setPhase('won');
        setRecord(submitBest(usedMoves));
      }
      return;
    }

    // 没配上：短暂停留后翻回去，这段时间内不响应点击
    busyRef.current = true;
    timeoutRef.current = window.setTimeout(() => {
      setOpen([]);
      busyRef.current = false;
      timeoutRef.current = null;
    }, 800);
  };

  const matchedPairs = cards.filter((card) => card.matched).length / 2;

  return (
    <GameFrame
      game={game}
      score={moves}
      best={best}
      extra={
        <div className="pill">
          <span>用时</span>
          <strong>{formatTime(seconds)}</strong>
        </div>
      }
      hint={game.controls}
    >
      <div className="memory-column">
        <div className="memory-levels">
          {LEVELS.map((item, index) => (
            <button
              key={item.label}
              type="button"
              className={`btn${index === levelIndex ? ' btn-primary' : ''}`}
              onClick={() => changeLevel(index)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div
          className="memory-grid"
          style={{ gridTemplateColumns: `repeat(${level.cols}, minmax(0, 1fr))` }}
        >
          {cards.map((card) => {
            const isOpen = card.matched || open.includes(card.id);
            return (
              <button
                key={card.id}
                type="button"
                className={`memory-card${isOpen ? ' is-open' : ''}${card.matched ? ' is-matched' : ''}`}
                onClick={() => flip(card)}
                aria-label={isOpen ? card.emoji : '未翻开的卡片'}
              >
                <span className="memory-inner">
                  <span className="memory-face memory-front">?</span>
                  <span className="memory-face memory-back">{card.emoji}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="memory-status">
          <span>
            已配对 {matchedPairs} / {level.pairs}
          </span>
          {phase === 'won' ? (
            <span className="win-text">
              全部找到！共用 {moves} 步
              {record ? ' · 新纪录！' : ''}
            </span>
          ) : null}
        </div>

        <div className="tool-row">
          <button type="button" className="btn" onClick={() => resetBoard(levelIndex)}>
            重新洗牌
          </button>
        </div>
      </div>
    </GameFrame>
  );
}
