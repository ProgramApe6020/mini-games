/**
 * 玩家运动 —— 房主模拟和客户端预测**共用同一份代码**。
 *
 * 这是客户端预测不漂移的关键：只要输入相同，两边算出来的位置就一模一样，
 * 网络校正只需要处理真正的不一致（比如撞到怪被击退、或丢包）。
 */
import { ATTACK_ANIM, ATTACK_CD, DASH_CD, DASH_SPEED, DASH_TIME, PLAYER_R, PLAYER_SPEED, TILE } from './constants.ts';
import { moveWithCollision } from './dungeon.ts';
import type { InputState, Vec } from './types.ts';

export type Motion = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  aimX: number;
  aimY: number;
  attackCd: number;
  attackAnim: number;
  dashCd: number;
  dashTime: number;
};

export type MotionResult = {
  /** 本帧是否挥出了一刀（房主据此结算伤害） */
  swung: boolean;
  /** 是否踩在楼梯上 */
  onStairs: boolean;
};

/**
 * 推进一帧玩家运动（原地修改 motion）。
 * 注意：会清掉 input.attack / input.dash —— 这两个是「按一次触发一次」。
 */
export function updateMotion(
  grid: Uint8Array,
  motion: Motion,
  input: InputState,
  dt: number,
  stairs: Vec,
): MotionResult {
  let dirX = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  let dirY = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  const length = Math.hypot(dirX, dirY);
  if (length > 0) {
    dirX /= length;
    dirY /= length;
  }

  motion.aimX = input.aimX;
  motion.aimY = input.aimY;

  // 冲刺
  motion.dashCd = Math.max(0, motion.dashCd - dt);
  if (input.dash && motion.dashCd <= 0 && motion.dashTime <= 0) {
    motion.dashTime = DASH_TIME;
    motion.dashCd = DASH_CD;
  }
  let speed = PLAYER_SPEED;
  if (motion.dashTime > 0) {
    motion.dashTime = Math.max(0, motion.dashTime - dt);
    speed = DASH_SPEED;
  }

  const moved = moveWithCollision(grid, motion.x, motion.y, PLAYER_R, dirX * speed * dt, dirY * speed * dt);
  const invDt = dt > 0 ? 1 / dt : 0;
  motion.vx = (moved.x - motion.x) * invDt;
  motion.vy = (moved.y - motion.y) * invDt;
  motion.x = moved.x;
  motion.y = moved.y;

  // 攻击
  motion.attackCd = Math.max(0, motion.attackCd - dt);
  motion.attackAnim = Math.max(0, motion.attackAnim - dt);
  let swung = false;
  if (input.attack && motion.attackCd <= 0) {
    motion.attackCd = ATTACK_CD;
    motion.attackAnim = ATTACK_ANIM;
    swung = true;
  }

  input.attack = false;
  input.dash = false;

  const onStairs =
    Math.abs(motion.x - stairs.x) < TILE * 0.9 && Math.abs(motion.y - stairs.y) < TILE * 0.9;

  return { swung, onStairs };
}
