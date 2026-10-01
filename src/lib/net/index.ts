/**
 * 传输层工厂 + 多人房间 Hook。
 *
 * 游戏组件只需要 `const net = useNetRoom(...)`，不用关心底层是 Supabase 还是
 * 同浏览器多标签页；没有配置 Supabase 时会自动降级。
 *
 * 关于座位：传输层只负责「谁在线」，**座位的权威分配在房主手里**
 * （房主按在线顺序把队友排成 1/2/3 号，并通过 roster 消息广播出去）。
 * 这里从 URL 读到的座位只是连上前大厅里的临时显示。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { netModeFromLocation, supabaseConfig, type NetMode } from '../config';
import { LocalTransport } from './local';
import {
  MAX_SEATS,
  getOrCreatePlayerId,
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
 * Supabase 客户端有 200 多 kB，只有真正进房间才需要，所以用动态 import 单独分包。
 */
export async function createTransport(mode: NetMode, vsn?: string): Promise<Transport> {
  if (mode === 'supabase' && supabaseConfig.configured) {
    const { SupabaseTransport } = await import('./supabase');
    return new SupabaseTransport(supabaseConfig.url, supabaseConfig.key, vsn);
  }
  return new LocalTransport();
}

export type RoomStatus = 'idle' | 'connecting' | 'waiting' | 'ready' | 'overfull' | 'error';

export type NetRoom = {
  room: string | null;
  status: RoomStatus;
  transportKind: TransportKind;
  configured: boolean;
  selfId: string;
  /** 临时座位（房主发的 roster 才是权威） */
  selfSeat: Seat;
  isHost: boolean;
  /** 在线成员（含自己） */
  peers: PeerInfo[];
  /** 除自己以外的队友 */
  teammates: PeerInfo[];
  isFull: boolean;
  send: (type: string, data?: unknown) => void;
  inviteUrl: string;
};

type Options = {
  gameId: string;
  room: string | null;
  /** 建房者传 host，通过邀请链接进来的人传 guest */
  role: 'host' | 'guest' | null;
  /** 大厅里显示的临时名字 */
  name: string;
  params: URLSearchParams;
  onMessage?: (message: NetMessage, api: NetApi) => void;
  onPeers?: (peers: PeerInfo[]) => void;
};

/** 传给消息回调的稳定接口。 */
export type NetApi = {
  send: (type: string, data?: unknown) => void;
};

export function useNetRoom({
  gameId,
  room,
  role,
  name,
  params,
  onMessage,
  onPeers,
}: Options): NetRoom {
  // ?pid=xxx 指定身份，主要给自动化测试用（同一标签页里的多个 iframe 共享 sessionStorage）
  const forcedId = params.get('pid');
  const playerId = useMemo(() => forcedId ?? getOrCreatePlayerId(), [forcedId]);
  const handlerRef = useRef(onMessage);
  const peersHandlerRef = useRef(onPeers);
  const transportRef = useRef<Transport | null>(null);
  const [peers, setPeers] = useState<PeerInfo[]>([]);
  const [transportStatus, setTransportStatus] = useState<TransportStatus>('offline');
  const [transportKind, setTransportKind] = useState<TransportKind>(
    supabaseConfig.configured ? 'supabase' : 'local',
  );

  const send = useCallback((type: string, data?: unknown) => {
    transportRef.current?.send(type, data);
  }, []);

  const api = useMemo<NetApi>(() => ({ send }), [send]);

  useEffect(() => {
    handlerRef.current = onMessage;
    peersHandlerRef.current = onPeers;
  }, [onMessage, onPeers]);

  const provisionalSeat: Seat = role === 'guest' ? 1 : 0;
  const paramsKey = params.toString();

  useEffect(() => {
    if (!room) {
      setPeers([]);
      return;
    }

    let disposed = false;
    let transport: Transport | null = null;

    // 稍微延迟再连接：React 严格模式下 effect 会跑两次，
    // 这样可以避免刚连上就断开，让队友那边看到在线状态闪一下。
    const timer = window.setTimeout(() => {
      if (disposed) return;

      void (async () => {
        const search = new URLSearchParams(paramsKey);
        const mode = resolveNetMode(search);
        // ?vsn=1.0.0 让 Supabase 客户端改用 JSON 序列化（自动化测试用）
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
          if (disposed) return;
          setPeers(list);
          peersHandlerRef.current?.(list);
        });
        next.onStatus((status) => {
          if (!disposed) setTransportStatus(status);
        });

        void next.connect(room, { id: playerId, seat: provisionalSeat, name });
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
  }, [room, provisionalSeat, playerId, name, paramsKey, api]);

  const status: RoomStatus = useMemo(() => {
    if (!room) return 'idle';
    if (transportStatus === 'error') return 'error';
    if (transportStatus !== 'online') return 'connecting';
    if (peers.length > MAX_SEATS) return 'overfull';
    return peers.length >= 2 ? 'ready' : 'waiting';
  }, [room, transportStatus, peers.length]);

  const teammates = useMemo(() => peers.filter((peer) => peer.id !== playerId), [peers, playerId]);

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
    selfSeat: provisionalSeat,
    isHost: role !== 'guest',
    peers,
    teammates,
    isFull: peers.length >= MAX_SEATS,
    send,
    inviteUrl,
  };
}

/** 从路由参数里解析房间码与角色。 */
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
