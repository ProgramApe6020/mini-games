import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, TouchEvent } from 'react';
import GameFrame from '../components/GameFrame';
import { useBestScore } from '../lib/storage';
import { getGame } from './registry';
import {
  SIZE,
  WIN_VALUE,
  addRandomTile,
  canMove,
  createGame,
  maxValue,
  move,
  resetTileIds,
  type Dir,
  type Tile,
} from './g2048/logic';

const game = getGame('2048')!;

type Board = { tiles: Tile[]; score: number };
type Status = 'playing' | 'over' | 'won';

const KEY_TO_DIR: Record<string, Dir> = {
  arrowup: 'up',
  w: 'up',
  arrowdown: 'down',
  s: 'down',
  arrowleft: 'left',
  a: 'left',
  arrowright: 'right',
  d: 'right',
};

function freshBoard(): Board {
  resetTileIds();
  return createGame();
}

export default function Game2048() {
  const [board, setBoard] = useState<Board>(() => freshBoard());
  const [past, setPast] = useState<Board[]>([]);
  const [status, setStatus] = useState<Status>('playing');
  const [record, setRecord] = useState(false);
  const [best, submitBest] = useBestScore('2048', 'max');
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

  const newGame = useCallback(() => {
    setBoard(freshBoard());
    setPast([]);
    setStatus('playing');
    setRecord(false);
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setBoard(past[past.length - 1]!);
    setPast(past.slice(0, -1));
    setStatus('playing');
  }, [past]);

  const doMove = useCallback(
    (dir: Dir) => {
      if (status === 'over') return;

      const result = move(board.tiles, dir);
      if (!result.moved) return;

      const nextTiles = addRandomTile(result.tiles);
      const nextScore = board.score + result.gained;

      setPast((prev) => [...prev, board].slice(-20));
      setBoard({ tiles: nextTiles, score: nextScore });
      if (status === 'won') setStatus('playing');

      if (!canMove(nextTiles)) {
        setStatus('over');
        setRecord(submitBest(nextScore));
      } else if (maxValue(nextTiles) >= WIN_VALUE && status !== 'won') {
        setStatus('won');
      }
    },
    [board, status, submitBest],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const dir = KEY_TO_DIR[event.key.toLowerCase()];
      if (!dir) return;
      event.preventDefault();
      doMove(dir);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [doMove]);

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
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 26) return;

    if (Math.abs(dx) > Math.abs(dy)) doMove(dx > 0 ? 'right' : 'left');
    else doMove(dy > 0 ? 'down' : 'up');
  };

  const top = maxValue(board.tiles);
  const reached = top >= WIN_VALUE;

  return (
    <GameFrame
      game={game}
      score={board.score}
      best={best}
      extra={
        <div className="pill">
          <span>最大</span>
          <strong style={{ color: reached ? 'var(--accent)' : undefined }}>{top || '—'}</strong>
        </div>
      }
      hint={game.controls}
    >
      <div className="g2048-column">
        {status === 'won' ? (
          <div className="banner">
            🎉 凑出 {WIN_VALUE} 了！可以继续挑战更大的数字。
            <button type="button" className="btn" onClick={() => setStatus('playing')}>
              继续玩
            </button>
          </div>
        ) : null}

        <div className="g2048-board" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <div className="g2048-cells">
            {Array.from({ length: SIZE * SIZE }, (_, index) => (
              <div className="g2048-cell" key={index} />
            ))}
          </div>

          {board.tiles.map((tile) => (
            <div
              className={`g2048-tile${tile.isNew ? ' is-new' : ''}${tile.merged ? ' is-merged' : ''}`}
              data-v={tile.value}
              key={tile.id}
              style={{ '--r': tile.r, '--c': tile.c } as CSSProperties}
            >
              <span>{tile.value}</span>
            </div>
          ))}

          {status === 'over' ? (
            <div className="overlay">
              <h2>没有可走的步了</h2>
              <p>
                本局得分 {board.score}
                {record ? ' · 新纪录！' : ''}
              </p>
              <div className="overlay-actions">
                <button type="button" className="btn btn-primary" onClick={newGame}>
                  再来一局
                </button>
                <button type="button" className="btn" onClick={undo} disabled={past.length === 0}>
                  撤销一步
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="tool-row">
          <button type="button" className="btn" onClick={undo} disabled={past.length === 0}>
            撤销一步
          </button>
          <button type="button" className="btn btn-primary" onClick={newGame}>
            新游戏
          </button>
        </div>
      </div>
    </GameFrame>
  );
}
