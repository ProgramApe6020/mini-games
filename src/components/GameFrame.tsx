import type { CSSProperties, ReactNode } from 'react';
import type { GameMeta } from '../games/registry';

type Props = {
  game: GameMeta;
  /** 当前成绩，null 表示还没开始 */
  score: number | null;
  /** 历史最佳，null 表示还没有记录 */
  best: number | null;
  /** 顶部右侧的额外面板，例如剩余生命 */
  extra?: ReactNode;
  /** 底部操作提示 */
  hint?: ReactNode;
  /** 联机对战时不需要「本局 / 最佳」这两个面板 */
  hideScores?: boolean;
  children: ReactNode;
};

/** 每个游戏共用的外框：返回链接、标题、成绩面板和操作提示。 */
export default function GameFrame({ game, score, best, extra, hint, hideScores, children }: Props) {
  return (
    <div className="game-page" style={{ '--accent': game.accent } as CSSProperties}>
      <header className="game-bar">
        <a className="back-link" href="#/">
          ← 全部游戏
        </a>
        <div className="game-title">
          <span className="game-emoji" aria-hidden="true">
            {game.emoji}
          </span>
          <h1>{game.title}</h1>
          <span className="game-subtitle">{game.subtitle}</span>
        </div>
        <div className="game-scores">
          {hideScores ? null : (
            <>
              <div className="pill">
                <span>{game.scoreLabel}</span>
                <strong>{score ?? 0}</strong>
              </div>
              <div className="pill pill-best">
                <span>最佳</span>
                <strong>{best ?? '—'}</strong>
              </div>
            </>
          )}
          {extra}
        </div>
      </header>

      <div className="game-stage">{children}</div>

      {hint ? <p className="game-hint">{hint}</p> : null}
    </div>
  );
}
