/**
 * 传输层工厂 + 联机房间 Hook。
 *
 * 游戏组件只需要 `const duel = useDuel(...)`，不用关心底层是 Supabase 还是
 * 同浏览器多标签页；没有配置 Supabase 时会自动降级。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { netModeFromLocation, supabaseConfig, type NetMode } from '../config';
import { LocalTransport } from './local';
import {
  getOrCreatePlayerId,
  seatLabel,
  type NetMessage,
  type PeerInfo,
  type Seat,
  type Transport,
  type TransportKind,
  type TransportStatus,
} from './types';

export * from './types';

export function resolveNetMode(params: URLSearchParams): NetMode {
  const override = netModeFromLocation(`?${params.toString()}`);
  if (override === 'local') return 'local';
  if (override === 'supabase' && supabaseConfig.configured) return 'supabase';
  return supabaseConfig.configured ? 'supabase' : 'local';
}

/**
 * 创建传输层。
 *
 * Supabase 客户端有 200 多 kB，而只玩单人游戏的人根本用不到，
 * 所以这里用动态 import —— 打包时会单独切出一个 chunk，只有真正进联机房间才下载。
 */
export async function createTransport(mode: NetMode, vsn?: string): Promise<Transport> {
  if (mode === 'supabase' && supabaseConfig.configured) {
    const { SupabaseTransport } = await import('./supabase');
    return new SupabaseTransport(supabaseConfig.url, supabaseConfig.key, vsn);
  }
  return new LocalTransport();
}

export type DuelStatus = 'idle' | 'connecting' | 'waiting' | 'ready' | 'full' | 'error';

export type Duel = {
  /** 房间码，null 表示还没进入房间 */
  room: string | null;
  status: DuelStatus;
  transportKind: TransportKind;
  /** 是否拿到了 Supabase 配置（false 表示在用同浏览器双标签模式） */
  configured: boolean;
  selfId: string;
  selfSeat: Seat;
  isHost: boolean;
  peers: PeerInfo[];
  opponent: PeerInfo | null;
  send: (type: string, data?: unknown) => void;
  /** 邀请对手的链接 */
  inviteUrl: string;
};

type Options = {
  gameId: string;
  room: string | null;
  seat: Seat;
  params: URLSearchParams;
  /**
   * 收到对手消息时回调。第二个参数是稳定的发送接口，
   * 这样在回调里可以直接回复消息，不必等 useDuel 返回后再拿 send。
   */
  onMessage?: (message: NetMessage, api: DuelApi) => void;
};

/** 传给消息回调的稳定接口。 */
export type DuelApi = {
  send: (type: string, data?: unknown) => void;
};

export function useDuel({ gameId, room, seat, params, onMessage }: Options): Duel {
  // 允许用 ?pid=xxx 指定玩家身份。默认从 sessionStorage 取（每个标签页一个，
  // 刷新不变）；显式指定的场景主要是自动化测试——同一个标签页里的两个 iframe
  // 共享 sessionStorage，不指定就会拿到同一个 id。
  const forcedId = params.get('pid');
  const playerId = useMemo(() => forcedId ?? getOrCreatePlayerId(), [forcedId]);
  const handlerRef = useRef(onMessage);
  const transportRef = useRef<Transport | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [transportStatus, setTransportStatus] = useState<TransportStatus>('offline');
  const [transportKind, setTransportKind] = useState<TransportKind>(
    supabaseConfig.configured ? 'supabase' : 'local',
  );

  const send = useCallback((type: string, data?: unknown) => {
    transportRef.current?.send(type, data);
  }, []);

  const api = useMemo<DuelApi>(() => ({ send }), [send]);

  useEffect(() => {
    handlerRef.current = onMessage;
  }, [onMessage]);

  const paramsKey = params.toString();

  useEffect(() => {
    if (!room) {
      setPeers([]);
      return;
    }

    let disposed = false;
    let transport: Transport | null = null;

    // 少量延迟再连接：React 严格模式下 effect 会执行两次，
    // 这样可以避免立刻连上又断开，让对手那边看到在线状态闪一下。
    const timer = window.setTimeout(() => {
      if (disposed) return;

      void (async () => {
        const search = new URLSearchParams(paramsKey);
        const mode = resolveNetMode(search);
        // ?vsn=1.0.0 可以让 Supabase 客户端改用 JSON 序列化（自动化测试用）
        const next = await createTransport(mode, search.get('vsn') ?? undefined);
        if (disposed) {
          next.disconnect();
          return;
        }

        transport = next;
        transportRef.current = next;
        setTransportKind(next.kind);

        next.onMessage((message) => {
          if (!disposed) handlerRef.current?.(message, api);
        });
        next.onPeers((list) => {
          if (!disposed) setPeers(list);
        });
        next.onStatus((status) => {
          if (!disposed) setTransportStatus(status);
        });

        void next.connect(room, { id: playerId, seat, name: seatLabel(seat) });
      })();
    }, 60);

    return () => {
      disposed = true;
      window.clearTimeout(timer);
      transport?.disconnect();
      transportRef.current = null;
      setPeers([]);
      setTransportStatus('offline');
    };
  }, [room, seat, playerId, paramsKey, api]);

  const status: DuelStatus = useMemo(() => {
    if (!room) return 'idle';
    if (transportStatus === 'error') return 'error';
    if (transportStatus !== 'online') return 'connecting';
    if (peers.length > 2) return 'full';
    return peers.length >= 2 ? 'ready' : 'waiting';
  }, [room, transportStatus, peers.length]);

  const opponent = useMemo(
    () => peers.find((peer) => peer.id !== playerId) ?? null,
    [peers, playerId],
  );

  const inviteUrl = useMemo(() => {
    if (!room) return '';
    const { origin, pathname } = window.location;
    return `${origin}${pathname}#/${gameId}?room=${room}&role=guest`;
  }, [gameId, room]);

  return {
    room,
    status,
    transportKind,
    configured: supabaseConfig.configured,
    selfId: playerId,
    selfSeat: seat,
    isHost: seat === 0,
    peers,
    opponent,
    send,
    inviteUrl,
  };
}

/** 从路由参数里解析房间码和座位。 */
export function useRoomParams(params: URLSearchParams): {
  room: string | null;
  role: 'host' | 'guest' | null;
  seat: Seat;
} {
  const raw = (params.get('room') ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const roleParam = params.get('role');
  const role: 'host' | 'guest' | null =
    roleParam === 'guest' ? 'guest' : roleParam === 'host' ? 'host' : null;
  return {
    room: raw.length >= 3 ? raw : null,
    role,
    seat: role === 'guest' ? 1 : 0,
  };
}

/** 复制文本，兼容旧浏览器与无剪贴板权限的情况。 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement('textarea');
      area.value = text;
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}
