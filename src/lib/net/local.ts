/**
 * 同浏览器多标签页传输实现（基于 BroadcastChannel）。
 *
 * 用途：
 *  1. 没有配置 Supabase 时的降级方案——打开两个标签页就能对战；
 *  2. 自动化测试用同一页面里的两个 iframe 互相通信。
 */
import {
  sortPeers,
  type NetMessage,
  type PeerInfo,
  type Transport,
  type TransportStatus,
} from './types';

const HEARTBEAT_MS = 1000;
/** 超过这个时间没收到心跳就认为对方已离开 */
const PEER_TIMEOUT_MS = 3500;

type Envelope =
  | { kind: 'hello'; peer: PeerInfo }
  | { kind: 'bye'; peer: PeerInfo }
  | { kind: 'msg'; message: NetMessage };

export class LocalTransport implements Transport {
  readonly kind = 'local' as const;

  private channel: BroadcastChannel | null = null;
  private self: PeerInfo | null = null;
  private peers = new Map<string, { info: PeerInfo; lastSeen: number }>();
  private heartbeat: number | null = null;

  private messageHandlers = new Set<(message: NetMessage) => void>();
  private peerHandlers = new Set<(peers: PeerInfo[]) => void>();
  private statusHandlers = new Set<(status: TransportStatus) => void>();

  private currentStatus: TransportStatus = 'offline';

  async connect(room: string, self: PeerInfo): Promise<void> {
    this.disconnect();
    this.self = self;
    this.setStatus('connecting');

    this.channel = new BroadcastChannel(`mini-games:room:${room}`);
    this.channel.onmessage = (event: MessageEvent<Envelope>) => this.receive(event.data);

    this.peers.clear();
    this.peers.set(self.id, { info: self, lastSeen: Date.now() });

    this.post({ kind: 'hello', peer: self });
    this.setStatus('online');
    this.emitPeers();

    this.heartbeat = window.setInterval(() => {
      this.post({ kind: 'hello', peer: self });
      this.prune();
    }, HEARTBEAT_MS);
  }

  disconnect(): void {
    if (this.heartbeat !== null) {
      window.clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.channel) {
      if (this.self) this.post({ kind: 'bye', peer: this.self });
      this.channel.onmessage = null;
      this.channel.close();
      this.channel = null;
    }
    this.peers.clear();
    this.self = null;
    this.setStatus('offline');
  }

  send(type: string, data?: unknown): void {
    if (!this.self) return;
    this.post({
      kind: 'msg',
      message: { from: this.self.id, seat: this.self.seat, type, data, at: Date.now() },
    });
  }

  onMessage(handler: (message: NetMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPeers(handler: (peers: PeerInfo[]) => void): () => void {
    this.peerHandlers.add(handler);
    handler(this.peerList());
    return () => this.peerHandlers.delete(handler);
  }

  onStatus(handler: (status: TransportStatus) => void): () => void {
    this.statusHandlers.add(handler);
    handler(this.currentStatus);
    return () => this.statusHandlers.delete(handler);
  }

  private post(envelope: Envelope): void {
    this.channel?.postMessage(envelope);
  }

  private receive(envelope: Envelope): void {
    if (!envelope || !this.self) return;

    if (envelope.kind === 'hello') {
      if (envelope.peer.id === this.self.id) return;
      const isNew = !this.peers.has(envelope.peer.id);
      this.peers.set(envelope.peer.id, { info: envelope.peer, lastSeen: Date.now() });
      // 新成员加入时回一个 hello，让对方立刻看到自己
      if (isNew) this.post({ kind: 'hello', peer: this.self });
      this.emitPeers();
      return;
    }

    if (envelope.kind === 'bye') {
      if (this.peers.delete(envelope.peer.id)) this.emitPeers();
      return;
    }

    if (envelope.kind === 'msg') {
      if (envelope.message.from === this.self.id) return;
      const known = this.peers.get(envelope.message.from);
      if (known) known.lastSeen = Date.now();
      for (const handler of this.messageHandlers) handler(envelope.message);
    }
  }

  private prune(): void {
    const now = Date.now();
    let changed = false;
    for (const [id, entry] of this.peers) {
      if (id === this.self?.id) continue;
      if (now - entry.lastSeen > PEER_TIMEOUT_MS) {
        this.peers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emitPeers();
  }

  private peerList(): PeerInfo[] {
    return sortPeers([...this.peers.values()].map((entry) => entry.info));
  }

  private emitPeers(): void {
    const list = this.peerList();
    for (const handler of this.peerHandlers) handler(list);
  }

  private setStatus(status: TransportStatus): void {
    this.currentStatus = status;
    for (const handler of this.statusHandlers) handler(status);
  }
}
