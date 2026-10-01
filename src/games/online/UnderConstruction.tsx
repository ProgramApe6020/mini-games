import GameFrame from '../../components/GameFrame';
import { LobbyScreen, NetBadge, WaitingScreen } from '../../components/RoomGate';
import { useDuel, useRoomParams } from '../../lib/net';
import { useHashParams } from '../../lib/router';
import { getGame } from '../registry';

/**
 * 联机游戏的临时占位页：完整的联机流程已经打通（创建/加入房间、等待对手），
 * 只是棋盘部分还没实现。参考 TicTacToe.tsx 的写法即可补上。
 */
export default function UnderConstruction({ gameId }: { gameId: string }) {
  const game = getGame(gameId);
  const params = useHashParams();
  const { room, seat } = useRoomParams(params);
  const duel = useDuel({ gameId, room, seat, params });

  if (!game) return null;

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
      ) : duel.status !== 'ready' ? (
        <WaitingScreen duel={duel} />
      ) : (
        <p className="lobby-hint">这个对战还在开发中，稍后就能玩到。</p>
      )}
    </GameFrame>
  );
}
