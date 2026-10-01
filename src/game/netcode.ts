/**
 * 客户端世界视图。
 *
 * 房主每秒发 20 次快照，直接照着画会一顿一顿的，所以这里做三件事：
 *   1. 别人的位置：向快照位置插值（平滑）；
 *   2. 自己的位置：本地预测（和房主跑同一份 motion.ts），快照只用来纠偏；
 *   3. 本地特效：伤害数字、火花、受击闪屏，纯客户端，不影响联机一致性。
 */
import { PLAYER_MAX_HP, STAIRS_HOLD, WORLD_H, WORLD_W } from './constants.ts';
import { generateDungeon } from './dungeon.ts';
import { updateMotion, type Motion } from './motion.ts';
import { phaseFromNumber, unpackSnapshot, type Snapshot, type SnapshotPlayer } from './snapshot.ts';
import { emptyInput, type Dungeon, type InputState, type WorldPhase } from './types.ts';
import type { Camera, FloatText, Spark, ViewEnemy, ViewItem, ViewPlayer, ViewProjectile, ViewState } from './view.ts';

/** 插值速度：每秒把差距吃掉这么多比例 */
const LERP_RATE = 14;
/** 自己位置与房主差距超过这个值就直接吸附（丢包 / 被击退） */
const SNAP_DISTANCE = 96;

/** 带插值目标的内部类型（不会外泄到渲染层） */
type TrackedPlayer = ViewPlayer & { targetX: number; targetY: number };
type TrackedEnemy = ViewEnemy & { targetX: number; targetY: number };
/** 抛射物在两次快照之间自己按速度飞行，观感更顺 */
type TrackedProjectile = ViewProjectile & { vx: number; vy: number };

type SelfState = Motion & {
  hp: number;
  down: number;
  kills: number;
  coins: number;
  hurting: number;
};

function createSelf(): SelfState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    aimX: 1,
    aimY: 0,
    attackCd: 0,
    attackAnim: 0,
    dashCd: 0,
    dashTime: 0,
    hp: PLAYER_MAX_HP,
    down: 0,
    kills: 0,
    coins: 0,
    hurting: 0,
  };
}

export class ClientWorld {
  seed = 0;
  floor = 1;
  phase: WorldPhase = 'playing';
  score = 0;
  enemiesLeft = 0;
  stairsProgress = 0;
  snapshot: Snapshot | null = null;
  dungeon: Dungeon;
  self = createSelf();
  input: InputState = emptyInput();
  floats: FloatText[] = [];
  sparks: Spark[] = [];
  damageFlash = 0;

  private enemies = new Map<number, TrackedEnemy>();
  private items = new Map<number, ViewItem>();
  private projectiles = new Map<number, TrackedProjectile>();
  private remote = new Map<number, TrackedPlayer>();

  /** 本机玩家的座位号（不用「参数属性」写法：Node 的类型剥离不支持它） */
  selfSeat: number;

  constructor(seed: number, selfSeat: number) {
    this.selfSeat = selfSeat;
    this.seed = seed;
    this.dungeon = generateDungeon(seed, 1);
  }

  /** 开局 / 重新开局 */
  start(seed: number, floor = 1): void {
    this.seed = seed;
    this.floor = floor;
    this.phase = 'playing';
    this.score = 0;
    this.dungeon = generateDungeon(seed, floor);
    this.self = createSelf();
    this.self.x = this.dungeon.start.x;
    this.self.y = this.dungeon.start.y;
    this.enemies.clear();
    this.items.clear();
    this.projectiles.clear();
    this.remote.clear();
    this.floats.length = 0;
    this.sparks.length = 0;
    this.damageFlash = 0;
    this.snapshot = null;
  }

  applySnapshot(packed: unknown): boolean {
    const snapshot = unpackSnapshot(packed);
    if (!snapshot) return false;

    // 换层或换种子：重建地图
    if (snapshot.seed !== this.seed || snapshot.floor !== this.floor) {
      this.seed = snapshot.seed;
      this.floor = snapshot.floor;
      this.dungeon = generateDungeon(snapshot.seed, snapshot.floor);
    }

    this.snapshot = snapshot;
    this.phase = phaseFromNumber(snapshot.phase);
    this.score = snapshot.score;
    this.stairsProgress = Math.max(0, Math.min(1, snapshot.stairsHold / STAIRS_HOLD));

    const seenPlayers = new Set<number>();
    for (const player of snapshot.players) {
      seenPlayers.add(player.seat);
      if (player.seat === this.selfSeat) this.applySelfAuthority(player);
      else this.applyRemote(player);
    }
    for (const seat of [...this.remote.keys()]) {
      if (!seenPlayers.has(seat)) this.remote.delete(seat);
    }

    const seenEnemies = new Set<number>();
    for (const enemy of snapshot.enemies) {
      seenEnemies.add(enemy.id);
      const known = this.enemies.get(enemy.id);
      this.enemies.set(enemy.id, {
        id: enemy.id,
        kind: enemy.kind,
        x: known ? known.x : enemy.x,
        y: known ? known.y : enemy.y,
        hp: enemy.hp,
        maxHp: enemy.maxHp,
        hurting: enemy.hurting,
        targetX: enemy.x,
        targetY: enemy.y,
      });
    }
    for (const id of [...this.enemies.keys()]) if (!seenEnemies.has(id)) this.enemies.delete(id);

    this.items = new Map(snapshot.items.map((item) => [item.id, { ...item }]));
    this.projectiles = new Map(
      snapshot.projectiles.map((projectile) => [projectile.id, { ...projectile }]),
    );

    this.enemiesLeft = snapshot.enemies.length;
    this.handleEvents(snapshot);
    return true;
  }

  private applySelfAuthority(player: SnapshotPlayer): void {
    const self = this.self;
    self.hp = player.hp;
    self.down = player.down;
    self.kills = player.kills;
    self.coins = player.coins;
    self.hurting = player.hurting;
    // 攻击动画以房主为准（本地也会自己推进，这里覆盖一下避免错位）
    self.attackAnim = Math.max(self.attackAnim, player.attackAnim);

    const dx = player.x - self.x;
    const dy = player.y - self.y;
    const distance = Math.hypot(dx, dy);

    if (distance > 3) {
      // 小幅纠偏：一次吃掉一部分差距；差距过大直接吸附
      const ratio = distance > SNAP_DISTANCE ? 1 : 0.3;
      self.x += dx * ratio;
      self.y += dy * ratio;
      if (ratio === 1) {
        self.vx = 0;
        self.vy = 0;
      }
    }
  }

  private applyRemote(player: SnapshotPlayer): void {
    const known = this.remote.get(player.seat);
    this.remote.set(player.seat, {
      seat: player.seat,
      name: known?.name ?? `玩家 ${player.seat + 1}`,
      x: known ? known.x : player.x,
      y: known ? known.y : player.y,
      hp: player.hp,
      maxHp: PLAYER_MAX_HP,
      aimX: player.aimX,
      aimY: player.aimY,
      attackAnim: player.attackAnim,
      down: player.down,
      hurting: player.hurting,
      kills: player.kills,
      coins: player.coins,
      isSelf: false,
      isHost: player.seat === 0,
      targetX: player.x,
      targetY: player.y,
    });
  }

  private handleEvents(snapshot: Snapshot): void {
    for (const event of snapshot.events) {
      if (event.type === 'hit') {
        this.floats.push({
          x: event.x,
          y: event.y - 10,
          vy: -26,
          life: 0.7,
          maxLife: 0.7,
          text: `-${Math.round(event.amount)}`,
          color: '#fca5a5',
        });
        this.spawnSparks(event.x, event.y, '#f87171', 4);
      } else if (event.type === 'kill') {
        this.spawnSparks(event.x, event.y, '#fbbf24', 10);
      } else if (event.type === 'pickup') {
        this.floats.push({
          x: event.x,
          y: event.y - 8,
          vy: -22,
          life: 0.8,
          maxLife: 0.8,
          text: event.kind === 'coin' ? '+10' : event.kind === 'heart' ? '回血' : '能量',
          color: event.kind === 'coin' ? '#fcd34d' : '#f9a8d4',
        });
      } else if (event.type === 'player-down' && event.seat === this.selfSeat) {
        this.damageFlash = 1;
      }
    }
  }

  private spawnSparks(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 40 + Math.random() * 120;
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.4,
        maxLife: 0.4,
        color,
        size: 2 + Math.random() * 2,
      });
    }
    if (this.sparks.length > 220) this.sparks.splice(0, this.sparks.length - 220);
  }

  /** 固定步长推进（客户端也是 1/60，与房主一致） */
  update(dt: number): void {
    if (this.self.down <= 0) {
      updateMotion(this.dungeon.grid, this.self, this.input, dt, this.dungeon.stairs);
    }

    const lerp = Math.min(1, dt * LERP_RATE);

    for (const player of this.remote.values()) {
      player.x += (player.targetX - player.x) * lerp;
      player.y += (player.targetY - player.y) * lerp;
      player.attackAnim = Math.max(0, player.attackAnim - dt);
      player.hurting = Math.max(0, player.hurting - dt);
    }

    for (const enemy of this.enemies.values()) {
      enemy.x += (enemy.targetX - enemy.x) * lerp;
      enemy.y += (enemy.targetY - enemy.y) * lerp;
      enemy.hurting = Math.max(0, enemy.hurting - dt);
    }

    for (const projectile of this.projectiles.values()) {
      projectile.x += projectile.vx * dt;
      projectile.y += projectile.vy * dt;
    }

    for (let i = this.floats.length - 1; i >= 0; i -= 1) {
      const float = this.floats[i]!;
      float.life -= dt;
      float.y += float.vy * dt;
      if (float.life <= 0) this.floats.splice(i, 1);
    }

    for (let i = this.sparks.length - 1; i >= 0; i -= 1) {
      const spark = this.sparks[i]!;
      spark.life -= dt;
      spark.x += spark.vx * dt;
      spark.y += spark.vy * dt;
      spark.vx *= Math.exp(-6 * dt);
      spark.vy *= Math.exp(-6 * dt);
      if (spark.life <= 0) this.sparks.splice(i, 1);
    }

    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.2);
    this.self.hurting = Math.max(0, this.self.hurting - dt);
  }

  toView(names: Record<number, string>): ViewState {
    const players: ViewPlayer[] = [
      {
        seat: this.selfSeat,
        name: names[this.selfSeat] ?? '你',
        x: this.self.x,
        y: this.self.y,
        hp: this.self.hp,
        maxHp: PLAYER_MAX_HP,
        aimX: this.self.aimX,
        aimY: this.self.aimY,
        attackAnim: this.self.attackAnim,
        down: this.self.down,
        hurting: this.self.hurting,
        kills: this.self.kills,
        coins: this.self.coins,
        isSelf: true,
        isHost: this.selfSeat === 0,
      },
    ];

    for (const player of this.remote.values()) {
      players.push({ ...player, name: names[player.seat] ?? player.name });
    }

    return {
      dungeon: this.dungeon,
      floor: this.floor,
      phase: this.phase,
      players,
      enemies: [...this.enemies.values()],
      projectiles: [...this.projectiles.values()],
      items: [...this.items.values()],
      stairsProgress: this.stairsProgress,
      enemiesLeft: this.enemiesLeft,
      score: this.score,
      floats: this.floats,
      sparks: this.sparks,
    };
  }
}

/** 相机：跟随本机玩家，并夹在地图范围内。 */
export function computeCamera(
  selfX: number,
  selfY: number,
  width: number,
  height: number,
): Camera {
  const halfW = width / 2;
  const halfH = height / 2;

  const clamp = (value: number, min: number, max: number) =>
    min > max ? (min + max) / 2 : Math.max(min, Math.min(max, value));

  return {
    x: clamp(selfX, halfW, WORLD_W - halfW),
    y: clamp(selfY, halfH, WORLD_H - halfH),
  };
}
