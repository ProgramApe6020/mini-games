/** 全局数值配置：手感相关的参数都集中在这里，方便调。 */

export const TILE = 32;
export const MAP_W = 64;
export const MAP_H = 48;
export const WORLD_W = MAP_W * TILE;
export const WORLD_H = MAP_H * TILE;

/** 瓦片类型 */
export const T_WALL = 0;
export const T_FLOOR = 1;
export const T_STAIRS = 2;

/** 玩家 */
export const PLAYER_R = 11;
export const PLAYER_SPEED = 168;
export const PLAYER_MAX_HP = 100;
/** 倒地后自动复活所需时间 */
export const RESPAWN_DELAY = 6;

/** 近战攻击 */
export const ATTACK_CD = 0.36;
export const ATTACK_ANIM = 0.16;
export const ATTACK_RANGE = 40;
export const ATTACK_ARC = Math.PI * 0.75;
export const ATTACK_DAMAGE = 26;
export const ATTACK_KNOCKBACK = 120;

/** 冲刺 */
export const DASH_CD = 1.6;
export const DASH_TIME = 0.16;
export const DASH_SPEED = 470;

/** 敌人 */
export const ENEMY_AGGRO_RANGE = 420;
export const ENEMY_LOSE_RANGE = 620;

/** 同步 */
export const SIM_DT = 1 / 60;
export const SNAPSHOT_HZ = 20;
export const SNAPSHOT_INTERVAL = 1 / SNAPSHOT_HZ;

/** 一层最多同时存在的怪物数量（防止广播包过大） */
export const MAX_ENEMIES = 42;
export const MAX_PROJECTILES = 80;
export const MAX_ITEMS = 40;

/** 楼梯需要站多久才能下层 */
export const STAIRS_HOLD = 0.8;
/** 掉落物 */
export const HEART_HEAL = 26;
export const COIN_SCORE = 10;
export const KILL_SCORE: Record<string, number> = {
  slime: 12,
  bat: 16,
  mage: 24,
  boss: 180,
};
