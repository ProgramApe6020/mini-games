import { useCallback, useEffect, useRef, useState } from 'react';
import { LobbyScreen, NetBadge, WaitingRoom, type RosterEntry } from './Lobby';
import { PLAYER_MAX_HP, SIM_DT, SNAPSHOT_INTERVAL } from '../game/constants';
import { ClientWorld, computeCamera } from '../game/netcode';
import { renderGame, renderMinimap } from '../game/render';
import { randomSeed } from '../game/rng';
import { packSnapshot } from '../game/snapshot';
import { stepWorld } from '../game/sim';
import { emptyInput, type InputState, type World, type WorldPhase } from '../game/types';
import { createPlayerState, createWorld } from '../game/world';
import {
  MAX_SEATS,
  useNetRoom,
  useRoomParams,
  type NetApi,
  type NetMessage,
  type PeerInfo,
} from '../lib/net';
import { loadNickname, saveNickname } from '../lib/nickname';
import { useHashParams } from '../lib/router';

type Phase = 'lobby' | 'waiting' | 'playing';

type HudPlayer = {
  seat: number;
  name: string;
  hp: number;
  down: number;
  kills: number;
  coins: number;
  isSelf: boolean;
};

type Hud = {
  floor: number;
  enemiesLeft: number;
  score: number;
  phase: WorldPhase;
  stairsProgress: number;
  players: HudPlayer[];
};

const EMPTY_HUD: Hud = {
  floor: 1,
  enemiesLeft: 0,
  score: 0,
  phase: 'playing',
  stairsProgress: 0,
  players: [],
};

/** 网络来的输入不可信，先收敛成合法值 */
function sanitizeInput(raw: unknown): InputState {
  const value = (raw ?? {}) as Partial<InputState>;
  let aimX = typeof value.aimX === 'number' && Number.isFinite(value.aimX) ? value.aimX : 1;
  let aimY = typeof value.aimY === 'number' && Number.isFinite(value.aimY) ? value.aimY : 0;
  const length = Math.hypot(aimX, aimY) || 1;
  aimX /= length;
  aimY /= length;
  return {
    up: Boolean(value.up),
    down: Boolean(value.down),
    left: Boolean(value.left),
    right: Boolean(value.right),
    aimX,
    aimY,
    attack: Boolean(value.attack),
    dash: Boolean(value.dash),
  };
}

const KEY_MAP: Record<string, keyof Pick<InputState, 'up' | 'down' | 'left' | 'right'>> = {
  w: 'up',
  arrowup: 'up',
  s: 'down',
  arrowdown: 'down',
  a: 'left',
  arrowleft: 'left',
  d: 'right',
  arrowright: 'right',
};

export default function DungeonGame() {
  const params = useHashParams();
  const { room, role } = useRoomParams(params);
  const isHost = role !== 'guest';

  const [nickname, setNickname] = useState(loadNickname);
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [phase, setPhase] = useState<Phase>(room ? 'waiting' : 'lobby');
  const [hud, setHud] = useState<Hud>(EMPTY_HUD);
  const [notice, setNotice] = useState('');

  const nicknameRef = useRef(nickname);
  const worldRef = useRef<World | null>(null);
  const clientRef = useRef<ClientWorld | null>(null);
  const startedRef = useRef(false);
  const inputRef = useRef<InputState>(emptyInput());
  const heldRef = useRef({ attack: false, dash: false });
  const keysRef = useRef<Record<string, boolean>>({});
  const mouseRef = useRef({ x: 0, y: 0 });
  const namesRef = useRef<Record<number, string>>({});
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const miniRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef({ width: 0, height: 0, dpr: 0 });
  const selfIdRef = useRef('');
  const mySeatRef = useRef(0);
  const sendRef = useRef<((type: string, data?: unknown) => void) | null>(null);

  useEffect(() => {
    nicknameRef.current = nickname;
    saveNickname(nickname);
  }, [nickname]);

  const applyNames = useCallback((list: RosterEntry[]) => {
    const map: Record<number, string> = {};
    for (const entry of list) map[entry.seat] = entry.name;
    namesRef.current = map;
  }, []);

  /** 房主按「房主 0、其余按 id 排序」分配座位 */
  const buildRoster = useCallback(
    (peers: PeerInfo[], selfId: string): RosterEntry[] => {
      const others = peers
        .filter((peer) => peer.id !== selfId)
        .sort((a, b) => a.id.localeCompare(b.id))
        .slice(0, MAX_SEATS - 1);
      return [
        { id: selfId, seat: 0, name: nicknameRef.current },
        ...others.map((peer, index) => ({ id: peer.id, seat: index + 1, name: peer.name })),
      ];
    },
    [],
  );

  const ensureClient = useCallback((seed: number, seat: number) => {
    const existing = clientRef.current;
    if (existing) existing.start(seed);
    else clientRef.current = new ClientWorld(seed, seat);
  }, []);

  /** 房主开一局新的远征 */
  const startRun = useCallback(() => {
    const selfId = selfIdRef.current;
    const list =
      roster.length > 0
        ? roster
        : [{ id: selfId, seat: 0, name: nicknameRef.current }];

    const seed = randomSeed();
    const players = list.map((entry) => ({ id: entry.id, seat: entry.seat, name: entry.name }));
    worldRef.current = createWorld(seed, players);
    const mySeat = list.find((entry) => entry.id === selfId)?.seat ?? 0;
    clientRef.current = new ClientWorld(seed, mySeat);
    startedRef.current = true;
    setRoster(list);
    applyNames(list);
    setHud(EMPTY_HUD);
    setPhase('playing');
    sendRef.current?.('start', { seed, roster: list });
  }, [roster, applyNames]);

  const onMessage = useCallback(
    (message: NetMessage, api: NetApi) => {
      const selfId = selfIdRef.current;

      if (message.type === 'roster') {
        const list = message.data as RosterEntry[] | undefined;
        if (!Array.isArray(list)) return;
        setRoster(list);
        applyNames(list);
        return;
      }

      if (message.type === 'start') {
        const data = message.data as { seed?: unknown; roster?: RosterEntry[] } | undefined;
        if (typeof data?.seed !== 'number') return;
        const list = Array.isArray(data.roster) ? data.roster : [];
        if (list.length > 0) {
          setRoster(list);
          applyNames(list);
        }
        const mySeat = list.find((entry) => entry.id === selfId)?.seat ?? 0;
        ensureClient(data.seed, mySeat);
        startedRef.current = true;
        setHud(EMPTY_HUD);
        setPhase('playing');
        return;
      }

      if (message.type === 'input' && isHost) {
        const world = worldRef.current;
        if (!world) return;
        const data = message.data as { seat?: unknown; input?: unknown } | undefined;
        const seat = typeof data?.seat === 'number' ? data.seat : -1;
        const player = world.players.find((item) => item.seat === seat);
        if (!player) return;
        player.input = sanitizeInput(data?.input);
        return;
      }

      if (message.type === 'snapshot' && !isHost) {
        if (!startedRef.current) {
          // 中途加入：第一份快照里带着种子与楼层，直接跟上
          clientRef.current = new ClientWorld(0, mySeatRef.current);
          startedRef.current = true;
          setPhase('playing');
          setNotice('已加入正在进行的远征');
          window.setTimeout(() => setNotice(''), 4000);
        }
        clientRef.current?.applySnapshot(message.data);
        void api;
      }
    },
    [isHost, applyNames, ensureClient],
  );

  /** 队友中途加入时，房主把他加进权威世界（下一次快照就会带上他） */
  const onPeers = useCallback(
    (peers: PeerInfo[]) => {
      if (!isHost) return;
      const selfId = selfIdRef.current;
      const list = buildRoster(peers, selfId);
      setRoster(list);
      applyNames(list);
      sendRef.current?.('roster', list);

      const world = worldRef.current;
      if (world && startedRef.current) {
        for (const entry of list) {
          if (world.players.some((player) => player.id === entry.id)) continue;
          world.players.push(
            createPlayerState(
              entry.id,
              entry.seat,
              entry.name,
              world.dungeon.start,
              world.players.length,
            ),
          );
        }
      }
    },
    [isHost, buildRoster, applyNames],
  );

  const net = useNetRoom({
    gameId: 'play',
    room,
    role,
    name: nickname,
    params,
    onMessage,
    onPeers,
  });

  sendRef.current = net.send;
  selfIdRef.current = net.selfId;

  const mySeat = roster.find((entry) => entry.id === net.selfId)?.seat ?? (isHost ? 0 : 1);
  mySeatRef.current = mySeat;

  // 大厅里每隔两秒重发一次名单，晚进来的队友也能拿到座位
  useEffect(() => {
    if (!isHost || !net.room || phase !== 'waiting') return undefined;
    const timer = window.setInterval(() => {
      const list = buildRoster(net.peers, net.selfId);
      sendRef.current?.('roster', list);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isHost, net.room, net.peers, net.selfId, phase, buildRoster]);

  const createRoom = () => {
    window.location.hash = `/play?room=${randomSeed().toString(36).slice(0, 4).toUpperCase()}&role=host`;
  };

  const joinRoom = (code: string) => {
    window.location.hash = `/play?room=${code}&role=guest`;
  };

  const leave = () => {
    window.location.hash = '/';
    startedRef.current = false;
    clientRef.current = null;
    worldRef.current = null;
    setPhase('lobby');
    setRoster([]);
  };

  // 房间变化时回到大厅/等待态
  useEffect(() => {
    if (!room) {
      setPhase('lobby');
      startedRef.current = false;
    } else if (!startedRef.current) {
      setPhase('waiting');
    }
  }, [room]);

  // ---------------------------------------------------------------- 主循环
  useEffect(() => {
    if (phase !== 'playing') return undefined;

    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    let raf = 0;
    let last = performance.now();
    let accumulator = 0;
    let snapshotTimer = 0;
    let inputTimer = 0;
    let hudTimer = 0;
    let minimapTimer = 0;
    let time = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (KEY_MAP[key]) {
        event.preventDefault();
        keysRef.current[KEY_MAP[key]!] = true;
      } else if (key === 'j') {
        event.preventDefault();
        heldRef.current.attack = true;
      } else if (key === ' ' || key === 'k' || key === 'shift') {
        event.preventDefault();
        heldRef.current.dash = true;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (KEY_MAP[key]) keysRef.current[KEY_MAP[key]!] = false;
      else if (key === 'j') heldRef.current.attack = false;
      else if (key === ' ' || key === 'k' || key === 'shift') heldRef.current.dash = false;
    };

    const onMouseMove = (event: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button === 0) heldRef.current.attack = true;
      if (event.button === 2) heldRef.current.dash = true;
    };

    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 0) heldRef.current.attack = false;
      if (event.button === 2) heldRef.current.dash = false;
    };

    const onContextMenu = (event: MouseEvent) => event.preventDefault();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    const loop = (now: number) => {
      raf = window.requestAnimationFrame(loop);
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;
      time += dt;

      const client = clientRef.current;
      const world = worldRef.current;
      if (!client) return;

      // 视口尺寸变化时重设画布（含高分屏适配）
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.round(rect.width));
      const height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (width !== viewportRef.current.width || height !== viewportRef.current.height || dpr !== viewportRef.current.dpr) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        viewportRef.current = { width, height, dpr };
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 组装本帧输入（移动 + 鼠标瞄准）
      const camera = computeCamera(client.self.x, client.self.y, width, height);
      const worldMouseX = camera.x + (mouseRef.current.x - width / 2);
      const worldMouseY = camera.y + (mouseRef.current.y - height / 2);
      let aimX = worldMouseX - client.self.x;
      let aimY = worldMouseY - client.self.y;
      const aimLength = Math.hypot(aimX, aimY) || 1;
      aimX /= aimLength;
      aimY /= aimLength;

      const input = inputRef.current;
      input.up = Boolean(keysRef.current.up);
      input.down = Boolean(keysRef.current.down);
      input.left = Boolean(keysRef.current.left);
      input.right = Boolean(keysRef.current.right);
      input.aimX = aimX;
      input.aimY = aimY;
      input.attack = heldRef.current.attack;
      input.dash = heldRef.current.dash;

      // 固定步长推进
      accumulator += dt;
      let steps = 0;
      while (accumulator >= SIM_DT && steps < 5) {
        accumulator -= SIM_DT;
        steps += 1;

        if (isHost && world) {
          const mine = world.players.find((player) => player.seat === mySeat);
          if (mine) {
            mine.input = { ...input };
          }
          stepWorld(world, SIM_DT);
        }

        const stepInput = { ...input };
        client.input = stepInput;
        client.update(SIM_DT);
      }

      if (isHost && world) {
        snapshotTimer += dt;
        if (snapshotTimer >= SNAPSHOT_INTERVAL) {
          snapshotTimer = 0;
          const packed = packSnapshot(world);
          client.applySnapshot(packed);
          sendRef.current?.('snapshot', packed);
          world.events.length = 0;
        }
      } else {
        inputTimer += dt;
        if (inputTimer >= 1 / 30) {
          inputTimer = 0;
          sendRef.current?.('input', { seat: mySeat, input });
        }
      }

      const view = client.toView(namesRef.current);
      renderGame({
        ctx,
        width,
        height,
        view,
        camera,
        time,
        damageFlash: client.damageFlash,
      });

      minimapTimer += dt;
      if (minimapTimer >= 0.2 && miniRef.current) {
        minimapTimer = 0;
        const mini = miniRef.current;
        const miniCtx = mini.getContext('2d');
        if (miniCtx) {
          miniCtx.setTransform(1, 0, 0, 1, 0, 0);
          renderMinimap(miniCtx, view, mini.width, client.selfSeat);
        }
      }

      hudTimer += dt;
      if (hudTimer >= 0.1) {
        hudTimer = 0;
        setHud({
          floor: view.floor,
          enemiesLeft: view.enemiesLeft,
          score: view.score,
          phase: view.phase,
          stairsProgress: view.stairsProgress,
          players: view.players.map((player) => ({
            seat: player.seat,
            name: player.name,
            hp: player.hp,
            down: player.down,
            kills: player.kills,
            coins: player.coins,
            isSelf: player.isSelf,
          })),
        });
      }
    };

    raf = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
    };
  }, [phase, isHost, mySeat]);

  // ---------------------------------------------------------------- 界面
  if (phase === 'lobby') {
    return (
      <div className="app-shell">
        <LobbyScreen
          onCreate={createRoom}
          onJoin={joinRoom}
          nickname={nickname}
          onNickname={setNickname}
          net={net}
        />
      </div>
    );
  }

  if (phase === 'waiting') {
    return (
      <div className="app-shell">
        <WaitingRoom
          net={net}
          roster={roster}
          nickname={nickname}
          onNickname={setNickname}
          onStart={startRun}
          hint={
            net.status === 'ready'
              ? '队友已就位，可以出发了。'
              : '先把邀请链接发给朋友；也可以一个人先下去。'
          }
        />
      </div>
    );
  }

  return (
    <div className="game-shell">
      <canvas ref={canvasRef} className="game-canvas" />

      <div className="hud">
        <div className="hud-top">
          <NetBadge net={net} />
          <span className="hud-chip">第 {hud.floor} 层</span>
          <span className="hud-chip">
            剩余怪物 <b>{hud.enemiesLeft}</b>
          </span>
          <span className="hud-chip">
            得分 <b>{hud.score}</b>
          </span>
          <button type="button" className="btn btn-sm" onClick={leave}>
            退出
          </button>
        </div>

        <div className="hud-players">
          {hud.players.map((player) => (
            <div
              key={player.seat}
              className={`hud-player${player.isSelf ? ' is-self' : ''}${player.down > 0 ? ' is-down' : ''}`}
              data-seat={player.seat}
            >
              <span className="hud-dot" data-seat={player.seat} />
              <span className="hud-name">
                {player.name}
                {player.isSelf ? '（你）' : ''}
              </span>
              <span className="hud-hp">
                <i style={{ width: `${Math.max(0, Math.min(100, (player.hp / PLAYER_MAX_HP) * 100))}%` }} />
              </span>
              {player.down > 0 ? (
                <span className="hud-warn">倒地 {player.down.toFixed(1)}s</span>
              ) : (
                <span className="hud-kills">击杀 {player.kills}</span>
              )}
            </div>
          ))}
        </div>

        <div className="hud-bottom">
          <canvas ref={miniRef} width={144} height={144} className="hud-minimap" />
          {notice ? <div className="hud-toast">{notice}</div> : null}
          {hud.phase === 'cleared' ? (
            <div className="hud-banner">
              本层已清空 —— 走到<b>楼梯</b>上停留片刻即可下层
              {hud.stairsProgress > 0 ? `（${Math.round(hud.stairsProgress * 100)}%）` : ''}
            </div>
          ) : null}
        </div>

        {hud.phase === 'gameover' ? (
          <div className="overlay">
            <h2>全员倒下</h2>
            <p>
              这一趟打到第 {hud.floor} 层，得分 {hud.score}
            </p>
            {isHost ? (
              <button type="button" className="btn btn-primary" onClick={startRun}>
                再来一趟
              </button>
            ) : (
              <p className="lobby-hint">等待房主重新开始…</p>
            )}
            <button type="button" className="btn" onClick={leave}>
              回到大厅
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
