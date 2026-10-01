/**
 * 客户端视图模型：把「网络快照 + 本地预测」整理成渲染器直接能画的数据。
 *
 * 分层是刻意的：
 *   - view.ts（本文件）：视图数据结构，网络层与渲染层共同的契约；
 *   - netcode.ts：把快照插值/校正成 ViewState；
 *   - render.ts：只负责画面，不碰逻辑。
 */
import type { Dungeon, EnemyKind, ItemKind, WorldPhase } from './types.ts';

export type ViewPlayer = {
  seat: number;
  name: string;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** 朝向单位向量 */
  aimX: number;
  aimY: number;
  /** > 0 表示正在挥砍（秒） */
  attackAnim: number;
  /** > 0 表示倒地（秒） */
  down: number;
  /** > 0 表示刚受击（用于闪白） */
  hurting: number;
  kills: number;
  coins: number;
  /** 是不是本机玩家（画高亮环） */
  isSelf: boolean;
  /** 是不是房主 */
  isHost: boolean;
};

export type ViewEnemy = {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  hurting: number;
};

export type ViewProjectile = {
  id: number;
  x: number;
  y: number;
  from: 'enemy' | 'player';
};

export type ViewItem = {
  id: number;
  x: number;
  y: number;
  kind: ItemKind;
};

/** 飘字（伤害数字 / 拾取提示），由客户端本地维护 */
export type FloatText = {
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  color: string;
};

/** 命中火花 */
export type Spark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
};

export type ViewState = {
  dungeon: Dungeon;
  floor: number;
  phase: WorldPhase;
  players: ViewPlayer[];
  enemies: ViewEnemy[];
  projectiles: ViewProjectile[];
  items: ViewItem[];
  /** 下层进度 0~1 */
  stairsProgress: number;
  enemiesLeft: number;
  score: number;
  /** 本地特效 */
  floats: FloatText[];
  sparks: Spark[];
};

export type Camera = { x: number; y: number };

export type RenderOptions = {
  ctx: CanvasRenderingContext2D;
  /** 逻辑视口大小（CSS 像素） */
  width: number;
  height: number;
  view: ViewState;
  camera: Camera;
  /** 累计时间（秒），用于呼吸/浮动等动画 */
  time: number;
  /** 受击闪屏强度 0~1 */
  damageFlash: number;
};
