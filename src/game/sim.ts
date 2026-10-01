/**
 * 世界推进（房主权威）。
 *
 * 所有规则都在这里：玩家移动/冲刺/挥砍、怪物 AI、抛射物、掉落、倒地复活、楼层推进。
 * 客户端不跑这一套（它只做本地预测 + 插值），所以这里可以放心写复杂逻辑。
 */
import {
  ATTACK_ARC,
  ATTACK_DAMAGE,
  ATTACK_KNOCKBACK,
  ATTACK_RANGE,
  COIN_SCORE,
  ENEMY_AGGRO_RANGE,
  ENEMY_LOSE_RANGE,
  HEART_HEAL,
  KILL_SCORE,
  MAX_ITEMS,
  PLAYER_R,
  RESPAWN_DELAY,
  STAIRS_HOLD,
  TILE,
} from './constants.ts';
import { hasLineOfSight, isWallTile, moveWithCollision, toTile } from './dungeon.ts';
import { updateMotion } from './motion.ts';
import type { EnemyState, InputState, Item, PlayerState, World, WorldEvent } from './types.ts';
import { ENEMY_STATS, enemyRadius, nextFloor, revivePlayer, scaleForFloor, spawnEnemy } from './world.ts';

export function pushEvent(world: World, event: WorldEvent): void {
  if (world.events.length < 24) world.events.push(event);
}

export function applyInput(world: World, seat: number, input: InputState): void {
  const player = world.players.find((item) => item.seat === seat);
  if (player) player.input = input;
}

function alivePlayers(world: World): PlayerState[] {
  return world.players.filter((player) => player.down <= 0);
}

function nearestPlayer(world: World, from: { x: number; y: number }): PlayerState | null {
  let best: PlayerState | null = null;
  let bestDistance = Infinity;
  for (const player of world.players) {
    if (player.down > 0) continue;
    const distance = (player.x - from.x) ** 2 + (player.y - from.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = player;
    }
  }
  return best;
}

function hurtPlayer(world: World, player: PlayerState, amount: number): void {
  if (player.down > 0) return;
  // 受击后的短暂无敌，避免被一堆怪瞬间秒掉
  if (player.hurting > 0.15) return;

  player.hp -= amount;
  player.hurting = 0.5;
  pushEvent(world, { type: 'hit', x: player.x, y: player.y, amount });

  if (player.hp <= 0) {
    player.hp = 0;
    player.down = RESPAWN_DELAY;
    player.vx = 0;
    player.vy = 0;
    pushEvent(world, { type: 'player-down', seat: player.seat });
  }
}

function dropLoot(world: World, x: number, y: number): void {
  const roll = Math.random();
  if (roll > 0.55 || world.items.length >= MAX_ITEMS) return;
  const kind: Item['kind'] = roll < 0.18 ? 'heart' : 'coin';
  world.items.push({ id: world.nextId++, x, y, kind, bob: Math.random() * Math.PI * 2 });
}

function killEnemy(world: World, enemy: EnemyState, attacker: PlayerState | null): void {
  world.score += KILL_SCORE[enemy.kind] ?? 10;
  if (attacker) attacker.kills += 1;
  pushEvent(world, { type: 'kill', x: enemy.x, y: enemy.y, kind: enemy.kind });
  dropLoot(world, enemy.x, enemy.y);
}

function damageEnemy(
  world: World,
  enemy: EnemyState,
  amount: number,
  attacker: PlayerState | null = null,
): void {
  if (enemy.hp <= 0) return;
  enemy.hp -= amount;
  enemy.hurting = 0.14;
  enemy.awake = true;
  pushEvent(world, { type: 'hit', x: enemy.x, y: enemy.y, amount });
  if (enemy.hp <= 0) {
    enemy.hp = 0;
    killEnemy(world, enemy, attacker);
  }
}

function meleeSwing(world: World, player: PlayerState): void {
  const halfArc = ATTACK_ARC / 2;
  const cosLimit = Math.cos(halfArc);

  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy) || 1;
    if (distance > ATTACK_RANGE + enemyRadius(enemy.kind)) continue;

    const dot = (dx * player.aimX + dy * player.aimY) / distance;
    if (dot < cosLimit) continue;

    damageEnemy(world, enemy, ATTACK_DAMAGE, player);
    enemy.vx += (dx / distance) * ATTACK_KNOCKBACK;
    enemy.vy += (dy / distance) * ATTACK_KNOCKBACK;
  }
}

function updatePlayer(world: World, player: PlayerState, index: number, dt: number): void {
  player.hurting = Math.max(0, player.hurting - dt);

  if (player.down > 0) {
    player.down -= dt;
    if (player.down <= 0) {
      revivePlayer(world, player, index);
      pushEvent(world, { type: 'player-revive', seat: player.seat });
    }
    return;
  }

  // 运动与攻击判定用的都是两端共用的那份代码（见 motion.ts）
  const result = updateMotion(world.dungeon.grid, player, player.input, dt, world.dungeon.stairs);
  player.onStairs = result.onStairs;
  if (result.swung) meleeSwing(world, player);
}

function spawnEnemyProjectile(world: World, enemy: EnemyState, target: PlayerState): void {
  const dx = target.x - enemy.x;
  const dy = target.y - enemy.y;
  const distance = Math.hypot(dx, dy) || 1;
  const speed = 200;
  const { damage } = scaleForFloor(enemy.kind, world.floor);
  world.projectiles.push({
    id: world.nextId++,
    x: enemy.x,
    y: enemy.y,
    vx: (dx / distance) * speed,
    vy: (dy / distance) * speed,
    from: 'enemy',
    dmg: damage,
    life: 3.2,
    color: '#c084fc',
  });
}

function spawnMinion(world: World, x: number, y: number): void {
  spawnEnemy(
    world,
    'slime',
    x + (Math.random() - 0.5) * TILE * 2,
    y + (Math.random() - 0.5) * TILE * 2,
    true,
  );
}

function updateEnemies(world: World, dt: number): void {
  const grid = world.dungeon.grid;

  for (const enemy of world.enemies) {
    if (enemy.hp <= 0) continue;
    enemy.hurting = Math.max(0, enemy.hurting - dt);
    enemy.cd = Math.max(0, enemy.cd - dt);
    enemy.touch = Math.max(0, enemy.touch - dt);

    const target = nearestPlayer(world, enemy);
    if (!target) continue;

    const dx = target.x - enemy.x;
    const dy = target.y - enemy.y;
    const distance = Math.hypot(dx, dy) || 1;
    const stats = ENEMY_STATS[enemy.kind];

    if (!enemy.awake && distance < ENEMY_AGGRO_RANGE && hasLineOfSight(grid, enemy, target)) {
      enemy.awake = true;
    }
    if (enemy.awake && distance > ENEMY_LOSE_RANGE) enemy.awake = false;

    let seekX = 0;
    let seekY = 0;
    let speed = stats.speed;

    if (enemy.awake) {
      if (enemy.kind === 'mage') {
        // 法师保持中距离并放法术
        if (distance < 150) {
          seekX = -dx / distance;
          seekY = -dy / distance;
        } else if (distance > 290) {
          seekX = dx / distance;
          seekY = dy / distance;
        }
        if (enemy.cd <= 0 && hasLineOfSight(grid, enemy, target)) {
          spawnEnemyProjectile(world, enemy, target);
          enemy.cd = Math.max(1.2, 2.4 - world.floor * 0.1);
        }
      } else if (enemy.kind === 'boss') {
        if (enemy.phase === 0 && enemy.hp <= enemy.maxHp * 0.5) {
          enemy.phase = 1;
          spawnMinion(world, enemy.x, enemy.y);
          spawnMinion(world, enemy.x, enemy.y);
        }
        if (enemy.phase === 2) {
          // 冲锋中：靠惯性推进，速度衰减后结束
          if (Math.hypot(enemy.vx, enemy.vy) < 150) enemy.phase = 1;
          speed = 0;
        } else {
          seekX = dx / distance;
          seekY = dy / distance;
          if (enemy.cd <= 0) {
            enemy.phase = 2;
            enemy.vx = (dx / distance) * 560;
            enemy.vy = (dy / distance) * 560;
            enemy.cd = 3.4;
          }
        }
      } else {
        seekX = dx / distance;
        seekY = dy / distance;
      }
    }

    const moved = moveWithCollision(
      grid,
      enemy.x,
      enemy.y,
      enemyRadius(enemy.kind),
      (seekX * speed + enemy.vx) * dt,
      (seekY * speed + enemy.vy) * dt,
    );
    enemy.x = moved.x;
    enemy.y = moved.y;
    const decay = Math.exp(-7 * dt);
    enemy.vx *= decay;
    enemy.vy *= decay;

    // 接触伤害
    if (enemy.awake && distance < enemyRadius(enemy.kind) + PLAYER_R + 2 && enemy.touch <= 0) {
      const { damage } = scaleForFloor(enemy.kind, world.floor);
      hurtPlayer(world, target, damage);
      enemy.touch = stats.touchCd;
    }
  }

  if (world.enemies.some((enemy) => enemy.hp <= 0)) {
    world.enemies = world.enemies.filter((enemy) => enemy.hp > 0);
  }
}

function updateProjectiles(world: World, dt: number): void {
  const grid = world.dungeon.grid;
  const alive: typeof world.projectiles = [];

  for (const projectile of world.projectiles) {
    projectile.life -= dt;
    if (projectile.life <= 0) continue;

    projectile.x += projectile.vx * dt;
    projectile.y += projectile.vy * dt;

    const tx = toTile(projectile.x);
    const ty = toTile(projectile.y);
    if (isWallTile(grid, tx, ty)) continue; // 撞墙

    let hit = false;
    for (const player of world.players) {
      if (player.down > 0) continue;
      if ((player.x - projectile.x) ** 2 + (player.y - projectile.y) ** 2 < (PLAYER_R + 5) ** 2) {
        hurtPlayer(world, player, projectile.dmg);
        hit = true;
        break;
      }
    }
    if (!hit) alive.push(projectile);
  }

  world.projectiles = alive;
}

function updateItems(world: World, dt: number): void {
  const kept: Item[] = [];

  for (const item of world.items) {
    item.bob += dt * 3;
    let taken = false;

    for (const player of world.players) {
      if (player.down > 0) continue;
      if ((player.x - item.x) ** 2 + (player.y - item.y) ** 2 > (TILE * 0.7) ** 2) continue;

      if (item.kind === 'heart') {
        player.hp = Math.min(player.maxHp, player.hp + HEART_HEAL);
      } else if (item.kind === 'potion') {
        player.hp = player.maxHp;
      } else {
        player.coins += 1;
        world.score += COIN_SCORE;
      }
      pushEvent(world, { type: 'pickup', x: item.x, y: item.y, kind: item.kind });
      taken = true;
      break;
    }

    if (!taken) kept.push(item);
  }

  world.items = kept;
}

/** 推进一帧（房主调用）。dt 建议固定为 1/60。 */
export function stepWorld(world: World, dt: number): void {
  if (world.phase === 'gameover') return;

  world.time += dt;
  world.tick += 1;

  world.players.forEach((player, index) => updatePlayer(world, player, index, dt));
  updateEnemies(world, dt);
  updateProjectiles(world, dt);
  updateItems(world, dt);

  world.enemiesLeft = world.enemies.length;

  if (world.phase === 'playing' && world.enemies.length === 0) {
    world.phase = 'cleared';
    pushEvent(world, { type: 'floor-cleared', floor: world.floor });
  }

  // 站在楼梯上足够久就下一层
  if (world.phase === 'cleared') {
    const holding = world.players.some((player) => player.down <= 0 && player.onStairs);
    if (holding) {
      world.stairsHold += dt;
      if (world.stairsHold >= STAIRS_HOLD) nextFloor(world);
    } else {
      world.stairsHold = 0;
    }
  }

  // 全员倒地 = 灭团
  if (world.players.length > 0 && alivePlayers(world).length === 0) {
    world.phase = 'gameover';
    pushEvent(world, { type: 'game-over' });
  }
}
