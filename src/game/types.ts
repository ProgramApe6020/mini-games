/** 游戏内实体与世界的类型定义（房主和客户端共用）。 */
import type { PlayerId, Seat } from '../lib/net/types.ts';

export type Vec = { x: number; y: number };

export type Room = { x: number; y: number; w: number; h: number };

export type Dungeon = {
  seed: number;
  floor: number;
  /** 长度 MAP_W*MAP_H，取值 T_WALL / T_FLOOR / T_STAIRS */
  grid: Uint8Array;
  rooms: Room[];
  /** 出生点（世界坐标） */
  start: Vec;
  /** 楼梯位置（世界坐标） */
  stairs: Vec;
  enemySpots: Vec[];
  itemSpots: Vec[];
};

export type InputState = {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  /** 瞄准方向（单位向量） */
  aimX: number;
  aimY: number;
  /** 本帧是否按下攻击 / 冲刺 */
  attack: boolean;
  dash: boolean;
};

export function emptyInput(): InputState {
  return { up: false, down: false, left: false, right: false, aimX: 1, aimY: 0, attack: false, dash: false };
}

export type PlayerState = {
  id: PlayerId;
  seat: Seat;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  aimX: number;
  aimY: number;
  attackCd: number;
  attackAnim: number;
  dashCd: number;
  dashTime: number;
  /** > 0 表示倒地等待复活（秒） */
  down: number;
  hurting: number;
  kills: number;
  coins: number;
  /** 是否正站在楼梯上（用于下层进度条） */
  onStairs: boolean;
  input: InputState;
};

export type EnemyKind = 'slime' | 'bat' | 'mage' | 'boss';

export type EnemyState = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  /** 技能冷却（法师射击 / boss 冲锋） */
  cd: number;
  /** 接触伤害冷却 */
  touch: number;
  hurting: number;
  awake: boolean;
  /** boss 用：阶段计时 */
  phase: number;
};

export type Projectile = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 伤害来源 */
  from: 'enemy' | 'player';
  dmg: number;
  life: number;
  color: string;
};

export type ItemKind = 'heart' | 'coin' | 'potion';

export type Item = {
  id: number;
  x: number;
  y: number;
  kind: ItemKind;
  bob: number;
};

export type WorldPhase = 'playing' | 'cleared' | 'gameover';

/** 一次性事件，用来触发提示与音效（不参与状态同步，随快照一起带过去） */
export type WorldEvent =
  | { type: 'hit'; x: number; y: number; amount: number }
  | { type: 'kill'; x: number; y: number; kind: EnemyKind }
  | { type: 'player-down'; seat: Seat }
  | { type: 'player-revive'; seat: Seat }
  | { type: 'floor-cleared'; floor: number }
  | { type: 'floor-enter'; floor: number }
  | { type: 'pickup'; x: number; y: number; kind: ItemKind }
  | { type: 'game-over' };

export type World = {
  seed: number;
  floor: number;
  tick: number;
  time: number;
  phase: WorldPhase;
  dungeon: Dungeon;
  players: PlayerState[];
  enemies: EnemyState[];
  projectiles: Projectile[];
  items: Item[];
  events: WorldEvent[];
  nextId: number;
  score: number;
  /** 本层剩余怪物数（给 UI 显示） */
  enemiesLeft: number;
  /** 有玩家站在楼梯上并保持的时长 */
  stairsHold: number;
};

export function enemyKindIndex(kind: EnemyKind): number {
  return kind === 'slime' ? 0 : kind === 'bat' ? 1 : kind === 'mage' ? 2 : 3;
}

export function enemyKindFromIndex(index: number): EnemyKind {
  return index === 0 ? 'slime' : index === 1 ? 'bat' : index === 2 ? 'mage' : 'boss';
}
