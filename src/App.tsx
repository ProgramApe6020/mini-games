import { useEffect } from 'react';
import DungeonGame from './components/GameView';
import { useHashRoute } from './lib/router';

/**
 * 整站现在就是一个游戏：不管 hash 里是什么路径，都进「地牢远征」。
 * 房间信息通过 `#/play?room=XXXX&role=guest` 这类参数传递，由 GameView 解析。
 */
export default function App() {
  const { path } = useHashRoute();

  useEffect(() => {
    document.title = path === 'play' ? '地牢远征 · 组队中' : '地牢远征 · 多人合作闯关';
  }, [path]);

  return <DungeonGame />;
}
