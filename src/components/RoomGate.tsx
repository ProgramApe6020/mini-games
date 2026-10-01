import { useState } from 'react';
import type { GameMeta } from '../games/registry';
import { supabaseConfig } from '../lib/config';
import { copyText, randomRoomCode, type Duel } from '../lib/net';

/** 显示当前用的是哪种联机通道。 */
export function NetBadge({ duel }: { duel: Duel }) {
  const online = duel.transportKind === 'supabase';
  return (
    <span
      className={`net-badge${online ? ' is-online' : ''}`}
      title={
        online
          ? '通过 Supabase Realtime 连接，可以和不同网络的朋友对战'
          : '未配置 Supabase，当前是同一浏览器多标签页模式'
      }
    >
      {online ? '🌐 联机模式' : '🖥 双标签模式'}
    </span>
  );
}

/** 没进房间时的入口：创建房间 / 输入房间码加入。 */
export function LobbyScreen({ game }: { game: GameMeta }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const createRoom = () => {
    window.location.hash = `/${game.id}?room=${randomRoomCode()}&role=host`;
  };

  const joinRoom = () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (clean.length < 3) {
      setError('房间码至少 3 位字符');
      return;
    }
    setError('');
    window.location.hash = `/${game.id}?room=${clean}&role=guest`;
  };

  return (
    <div className="lobby">
      <p className="lobby-lead">{game.tagline}</p>

      <div className="lobby-actions">
        <button type="button" className="btn btn-primary" onClick={createRoom}>
          创建房间
        </button>
        <span className="lobby-or">或</span>
        <div className="join-row">
          <input
            className="join-input"
            value={code}
            maxLength={6}
            placeholder="房间码"
            aria-label="房间码"
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onKeyDown={(event) => {
              if (event.key === 'Enter') joinRoom();
            }}
          />
          <button type="button" className="btn" onClick={joinRoom}>
            加入
          </button>
        </div>
      </div>

      {error ? <p className="lobby-error">{error}</p> : null}

      <ul className="lobby-tips">
        <li>创建房间后，把邀请链接发给对手，对方打开即进入同一房间。</li>
        <li>两名玩家到齐后自动开始；中途刷新页面也能回到房间。</li>
        <li>成绩不会上传服务器，只在对局期间通过实时通道传递。</li>
      </ul>

      {supabaseConfig.configured ? null : (
        <p className="lobby-note">
          当前<strong>未配置 Supabase</strong>：可以用同一浏览器的两个标签页对战（把邀请链接粘到新标签页打开即可）。
          想和不同网络的朋友对战，请参照 README 配置 Supabase 后重新部署。
        </p>
      )}
    </div>
  );
}

/** 等待对手 / 显示房间信息。 */
export function WaitingScreen({
  duel,
  message,
  onLeave,
}: {
  duel: Duel;
  message?: string;
  onLeave?: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyText(duel.inviteUrl);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const leave = () => {
    onLeave?.();
    const gameId = window.location.hash.replace(/^#\//, '').split('?')[0];
    window.location.hash = `/${gameId}`;
  };

  return (
    <div className="lobby">
      <div className="room-box">
        <span className="room-label">房间码</span>
        <strong className="room-code">{duel.room}</strong>
      </div>

      <div className="peer-row">
        {[0, 1].map((seat) => {
          const peer = duel.peers.find((item) => item.seat === seat);
          const isSelf = peer?.id === duel.selfId;
          return (
            <span key={seat} className={`peer-chip${peer ? '' : ' is-empty'}${isSelf ? ' is-self' : ''}`}>
              {peer ? `${peer.name}${isSelf ? '（你）' : ''}` : `等待玩家 ${seat + 1}…`}
            </span>
          );
        })}
      </div>

      <p className="lobby-hint">
        {message ??
          (duel.status === 'ready'
            ? '两名玩家已就位，正在开始…'
            : '把下面的邀请链接发给对手，对方打开就能进同一房间。')}
      </p>

      <button type="button" className="btn btn-primary" onClick={handleCopy}>
        {copied ? '已复制 ✓' : '复制邀请链接'}
      </button>

      <p className="invite-url">{duel.inviteUrl}</p>

      {duel.status === 'error' ? (
        <p className="lobby-error">实时通道连接失败，请检查网络后刷新重试。</p>
      ) : null}
      {duel.status === 'full' ? (
        <p className="lobby-error">这个房间已经有两个人了。</p>
      ) : null}

      <button type="button" className="btn" onClick={leave}>
        退出房间
      </button>
    </div>
  );
}

/** 对局中顶部的一条状态栏：房间码 + 双方在线情况。 */
export function DuelStatusBar({ duel, scores, unit }: { duel: Duel; scores: [number, number]; unit: string }) {
  const opponentOnline = duel.peers.length >= 2;
  return (
    <div className="duel-bar">
      <span className="duel-room">房间 {duel.room}</span>
      <span className="duel-score is-self">
        <b>{duel.selfSeat === 0 ? '玩家 1' : '玩家 2'}</b>
        <em>你</em>
        <strong>{scores[duel.selfSeat]}</strong>
      </span>
      <span className={`duel-score${opponentOnline ? '' : ' is-offline'}`}>
        <b>{duel.selfSeat === 0 ? '玩家 2' : '玩家 1'}</b>
        <em>{opponentOnline ? '对手' : '对手已离线'}</em>
        <strong>{scores[duel.selfSeat === 0 ? 1 : 0]}</strong>
      </span>
      <span className="duel-unit">{unit}</span>
    </div>
  );
}
