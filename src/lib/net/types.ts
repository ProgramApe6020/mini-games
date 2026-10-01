/** 联机对战的传输层类型定义。 */

export type Seat = 0 | 1;

export type PlayerId = string;

export type PeerInfo = {
  id: PlayerId;
  seat: Seat;
  /** 展示用的名字，例如「玩家 1」 */
  name: string;
};

export type NetMessage = {
  from: PlayerId;
  seat: Seat;
  /** 消息类型，由各游戏自己解释，例如 'move' / 'state' / 'input' */
  type: string;
  data?: unknown;
  /** 发送时间（毫秒时间戳），仅用于调试与排序 */
  at: number;
};

export type TransportStatus = 'connecting' | 'online' | 'offline' | 'error';

export type TransportKind = 'supabase' | 'local';

export interface Transport {
  readonly kind: TransportKind;
  /** 加入房间并广播自己的在线状态 */
  connect(room: string, self: PeerInfo): Promise<void>;
  disconnect(): void;
  send(type: string, data?: unknown): void;
  onMessage(handler: (message: NetMessage) => void): () => void;
  /** 在线成员变化（包含自己） */
  onPeers(handler: (peers: PeerInfo[]) => void): () => void;
  onStatus(handler: (status: TransportStatus) => void): () => void;
}

/** 生成房间码：去掉 0/O、1/I/L 这类容易看错的字符。 */
const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomRoomCode(length = 4): string {
  let code = '';
  for (let i = 0; i < length; i += 1) {
    code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
  }
  return code;
}

/** 生成一个随机的玩家 id（存在 sessionStorage，刷新后不变，不同标签页不同）。 */
export function getOrCreatePlayerId(): PlayerId {
  const KEY = 'mini-games:player-id';
  try {
    const existing = window.sessionStorage.getItem(KEY);
    if (existing) return existing;
    const id = Math.random().toString(36).slice(2, 10);
    window.sessionStorage.setItem(KEY, id);
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
}

export function seatLabel(seat: Seat): string {
  return seat === 0 ? '玩家 1' : '玩家 2';
}

/** 按座位排序，保证两端看到的成员顺序一致。 */
export function sortPeers(peers: PeerInfo[]): PeerInfo[] {
  return [...peers].sort((a, b) => a.seat - b.seat || a.id.localeCompare(b.id));
}
