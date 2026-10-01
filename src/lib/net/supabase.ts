/**
 * Supabase Realtime 传输实现。
 *
 * 只用 Broadcast（广播消息）和 Presence（在线状态）两个能力：
 * 不建表、不写数据库、不依赖行级安全策略，因此 anon key 放在前端也没有数据风险。
 */
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import {
  sortPeers,
  type NetMessage,
  type PeerInfo,
  type Transport,
  type TransportStatus,
} from './types';

export class SupabaseTransport implements Transport {
  readonly kind = 'supabase' as const;

  private client: SupabaseClient;
  private channel: RealtimeChannel | null = null;
  private self: PeerInfo | null = null;
  private peers: PeerInfo[] = [];

  private messageHandlers = new Set<(message: NetMessage) => void>();
  private peerHandlers = new Set<(peers: PeerInfo[]) => void>();
  private statusHandlers = new Set<(status: TransportStatus) => void>();

  private currentStatus: TransportStatus = 'offline';

  constructor(url: string, key: string) {
    this.client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 25 } },
    });
  }

  async connect(room: string, self: PeerInfo): Promise<void> {
    this.disconnect();
    this.self = self;
    this.setStatus('connecting');

    const channel = this.client.channel(`mini-games:${room}`, {
      config: {
        broadcast: { self: false, ack: false },
        presence: { key: self.id },
      },
    });

    channel
      .on('broadcast', { event: 'msg' }, (incoming: unknown) => {
        // 不同版本的 supabase-js 回调参数略有差异，这里两种形态都兼容
        const raw = (incoming as { payload?: unknown } | null)?.payload ?? incoming;
        const message = raw as NetMessage | undefined;
        if (!message || typeof message.type !== 'string') return;
        if (message.from === this.self?.id) return;
        for (const handler of this.messageHandlers) handler(message);
      })
      .on('presence', { event: 'sync' }, () => this.syncPresence());

    this.channel = channel;

    await new Promise<void>((resolve) => {
      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          void channel.track({ id: self.id, seat: self.seat, name: self.name });
          this.setStatus('online');
          resolve();
          return;
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.setStatus('error');
          resolve();
          return;
        }
        if (status === 'CLOSED') {
          this.setStatus('offline');
          resolve();
        }
      });
    });
  }

  disconnect(): void {
    const channel = this.channel;
    this.channel = null;
    if (channel) {
      void channel.untrack();
      void this.client.removeChannel(channel);
    }
    this.peers = [];
    this.self = null;
    this.setStatus('offline');
  }

  send(type: string, data?: unknown): void {
    const self = this.self;
    const channel = this.channel;
    if (!self || !channel) return;
    const payload: NetMessage = { from: self.id, seat: self.seat, type, data, at: Date.now() };
    void channel.send({ type: 'broadcast', event: 'msg', payload });
  }

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPeers(handler: (peers: PeerInfo[]) => void): () => void {
    this.peerHandlers.add(handler);
    handler(this.peers);
    return () => this.peerHandlers.delete(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.currentStatus);
    return () => this.statusHandlers.delete(handler);
  }

  private syncPresence(): void {
    const state = (this.channel?.presenceState() ?? {}) as Record<string, unknown[]>;
    const unique = new Map<string, PeerInfo>();

    for (const entries of Object.values(state)) {
      for (const entry of entries) {
        const record = entry as Partial<PeerInfo> | null;
        if (!record || typeof record.id !== 'string') continue;
        unique.set(record.id, {
          id: record.id,
          seat: record.seat === 1 ? 1 : 0,
          name: typeof record.name === 'string' ? record.name : '玩家',
        });
      }
    }

    this.peers = sortPeers([...unique.values()]);
    for (const handler of this.peerHandlers) handler(this.peers);
  }

  private setStatus(status: TransportStatus): void {
    this.currentStatus = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}
