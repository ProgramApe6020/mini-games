import { useState } from 'react';
import { MAX_SEATS, copyText, type NetRoom } from '../lib/net';

/** 显示当前联机通道 */
export function NetBadge({ net }: { net: NetRoom }) {
  const online = net.transportKind === 'supabase';
  return (
    <span
      className={`net-badge${online ? ' is-online' : ''}`}
      title={
        online
          ? '通过 Supabase Realtime 连接，可以和不同网络的朋友一起玩'
          : '未配置 Supabase，当前是同一浏览器多标签页模式'
      }
    >
      {online ? '🌐 联机模式' : '🖥 本地多标签'}
    </span>
  );
}

function NicknameField({
  nickname,
  onNickname,
}: {
  nickname: string;
  onNickname: (value: string) => void;
}) {
  return (
    <label className="nickname-field">
      <span>你的名字</span>
      <input
        className="nickname-input"
        value={nickname}
        maxLength={10}
        onChange={(event) => onNickname(event.target.value)}
        placeholder="冒险者"
      />
    </label>
  );
}

/** 没进房间时的入口 */
export function LobbyScreen({
  onCreate,
  onJoin,
  nickname,
  onNickname,
  net,
}: {
  onCreate: () => void;
  onJoin: (room: string) => void;
  nickname: string;
  onNickname: (value: string) => void;
  net: NetRoom;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const join = () => {
    const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (clean.length < 3) {
      setError('房间码至少 3 位');
      return;
    }
    setError('');
    onJoin(clean);
  };

  return (
    <div className="lobby">
      <header className="lobby-hero">
        <NetBadge net={net} />
        <h1>地牢远征</h1>
        <p>
          最多 <strong>{MAX_SEATS}</strong> 人组队闯地牢：清光一层的怪物才能下楼，层数越深怪越凶。
          倒下后 6 秒自动在入口复活，但<strong>全员倒地</strong>这一趟就结束了。
        </p>
      </header>

      <NicknameField nickname={nickname} onNickname={onNickname} />

      <div className="lobby-actions">
        <button type="button" className="btn btn-primary btn-lg" onClick={onCreate}>
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
              if (event.key === 'Enter') join();
            }}
          />
          <button type="button" className="btn" onClick={join}>
            加入
          </button>
        </div>
      </div>

      {error ? <p className="lobby-error">{error}</p> : null}

      <ul className="lobby-tips">
        <li>
          <b>移动</b> WASD / 方向键 · <b>瞄准</b> 鼠标 · <b>攻击</b> 鼠标左键或 J ·{' '}
          <b>冲刺</b> 空格 / K
        </li>
        <li>创建房间后把邀请链接发给朋友，对方打开即进入同一队。</li>
        <li>房间最多 {MAX_SEATS} 人；房主点「进入地牢」开始。</li>
      </ul>

      {net.configured ? null : (
        <p className="lobby-note">
          当前<b>未配置 Supabase</b>：可以用同一浏览器的多个标签页组队（邀请链接在本机打开即可）。
          想和不同网络的朋友玩，按 README 配置 Supabase 后重新部署。
        </p>
      )}
    </div>
  );
}

export type RosterEntry = { id: string; seat: number; name: string };

/** 等待队友 / 房主开局 */
export function WaitingRoom({
  net,
  roster,
  nickname,
  onNickname,
  onStart,
  hint,
}: {
  net: NetRoom;
  /** 房主分配的座位（房主本地算出后会广播；没收到时先用在线状态兜底） */
  roster: RosterEntry[];
  nickname: string;
  onNickname: (value: string) => void;
  onStart: () => void;
  hint?: string;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const ok = await copyText(net.inviteUrl);
    setCopied(ok);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const leave = () => {
    window.location.hash = '/';
  };

  const slots = Array.from({ length: MAX_SEATS }, (_, seat) => {
    const fromRoster = roster.find((entry) => entry.seat === seat);
    const fromPresence = net.peers.find((peer) => peer.seat === seat);
    const entry = fromRoster ?? (fromPresence ? { id: fromPresence.id, seat, name: fromPresence.name } : null);
    return {
      seat,
      name: entry?.name,
      online: Boolean(entry) && (entry!.id === net.selfId || net.peers.some((p) => p.id === entry!.id)),
      isSelf: entry?.id === net.selfId,
    };
  });

  return (
    <div className="lobby">
      <header className="lobby-hero">
        <NetBadge net={net} />
        <h1>集结中</h1>
      </header>

      <div className="room-box">
        <span className="room-label">房间码</span>
        <strong className="room-code">{net.room}</strong>
      </div>

      <div className="slots">
        {slots.map((slot) => (
          <div key={slot.seat} className={`slot${slot.online ? ' is-on' : ''}`}>
            <span className="slot-avatar" data-seat={slot.seat} />
            <span className="slot-name">
              {slot.online ? slot.name || `玩家 ${slot.seat + 1}` : '等待加入…'}
              {slot.isSelf ? '（你）' : ''}
            </span>
            {slot.seat === 0 ? <span className="slot-tag">房主</span> : null}
          </div>
        ))}
      </div>

      <div className="lobby-actions">
        <button type="button" className="btn" onClick={copy}>
          {copied ? '已复制 ✓' : '复制邀请链接'}
        </button>
        {net.isHost ? (
          <button type="button" className="btn btn-primary" onClick={onStart}>
            进入地牢
          </button>
        ) : (
          <span className="lobby-hint">等待房主开始…</span>
        )}
      </div>

      <p className="invite-url">{net.inviteUrl}</p>

      <NicknameField nickname={nickname} onNickname={onNickname} />

      {hint ? <p className="lobby-hint">{hint}</p> : null}
      {net.status === 'error' ? (
        <p className="lobby-error">实时通道连接失败，请检查网络后刷新重试。</p>
      ) : null}
      {net.status === 'overfull' ? (
        <p className="lobby-error">房间已经满了（最多 {MAX_SEATS} 人）。</p>
      ) : null}

      <button type="button" className="btn" onClick={leave}>
        退出房间
      </button>
    </div>
  );
}
