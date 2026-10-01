import { useEffect, useState } from 'react';
import type { ComponentType, CSSProperties } from 'react';
import { useHashRoute } from './lib/router';
import { GAMES, getGame, type GameMeta } from './games/registry';
import { clearAllBests, useBestScore } from './lib/storage';
import Snake from './games/Snake';
import Game2048 from './games/Game2048';
import Breakout from './games/Breakout';
import Memory from './games/Memory';

const GAME_COMPONENTS: Record<string, ComponentType> = {
  snake: Snake,
  '2048': Game2048,
  breakout: Breakout,
  memory: Memory,
};

function GameCard({ game }: { game: GameMeta }) {
  const [best] = useBestScore(game.id, game.scoreMode);
  return (
    <a className="card" href={`#/${game.id}`} style={{ '--accent': game.accent } as CSSProperties}>
      <div className="card-top">
        <span className="card-emoji" aria-hidden="true">
          {game.emoji}
        </span>
        <span className="card-best">
          最佳 <strong>{best ?? '—'}</strong>
        </span>
      </div>
      <h2>
        {game.title}
        <span>{game.subtitle}</span>
      </h2>
      <p>{game.tagline}</p>
      <span className="card-play">开始玩 →</span>
    </a>
  );
}

function Home() {
  // 清除记录后换掉 key，让卡片重新挂载以读取最新成绩
  const [version, setVersion] = useState(0);

  const handleClear = () => {
    if (!window.confirm('确定要清除所有游戏的最佳成绩吗？')) return;
    clearAllBests();
    setVersion((value) => value + 1);
  };

  return (
    <div className="home">
      <header className="hero">
        <p className="hero-kicker">React · TypeScript · Vite</p>
        <h1>小游戏合集</h1>
        <p className="hero-sub">
          四个随手就能玩的小游戏，键盘和触屏都支持。成绩只保存在你自己的浏览器里，不会上传。
        </p>
      </header>

      <main className="grid" key={version}>
        {GAMES.map((game) => (
          <GameCard key={game.id} game={game} />
        ))}
      </main>

      <footer className="footer">
        <button type="button" className="btn" onClick={handleClear}>
          清除本地成绩
        </button>
        <a
          className="footer-note footer-link"
          href="https://github.com/ProgramApe6020/mini-games"
          target="_blank"
          rel="noreferrer"
        >
          源码在 GitHub · 托管于 GitHub Pages
        </a>
      </footer>
    </div>
  );
}

function NotFound({ id }: { id: string }) {
  return (
    <div className="home">
      <header className="hero">
        <h1>没有这个游戏</h1>
        <p className="hero-sub">地址里的 “{id}” 不在游戏列表里，回到首页挑一个吧。</p>
        <a className="btn btn-primary" href="#/">
          返回全部游戏
        </a>
      </header>
    </div>
  );
}

export default function App() {
  const [route] = useHashRoute();
  const meta = getGame(route);
  const Game = GAME_COMPONENTS[route];

  useEffect(() => {
    document.title = meta ? `${meta.title} · 小游戏合集` : '小游戏合集 · Mini Games';
  }, [meta]);

  if (route === 'home') return <Home />;
  if (!meta || !Game) return <NotFound id={route} />;
  return <Game />;
}
