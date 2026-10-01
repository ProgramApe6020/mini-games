/**
 * 渲染层：只负责把 ViewState 画到 canvas 上。
 *
 * 约定：
 *   - 不读全局状态、不做 DOM 操作，进来的 ctx 已经由调用方按 dpr 设好 transform，
 *     这里绝不改动 transform，只做裁剪与视口换算；
 *   - 相机（camera.x/y）是视口中心的世界坐标，绘制时统一换算成屏幕坐标；
 *   - 只画可见范围内的瓦片与实体，每帧不做大对象分配（渐变/火花缓冲都尽量省）。
 */
import { MAP_H, MAP_W, T_STAIRS, T_WALL, TILE, WORLD_H, WORLD_W } from './constants.ts';
import { tileAt, toTile } from './dungeon.ts';
import type { FloatText, RenderOptions, Spark, ViewEnemy, ViewItem, ViewPlayer, ViewProjectile, ViewState } from './view.ts';

/** 座位配色（0~3），越界时回落到 0 号 */
const SEAT_COLORS = ['#7dd3fc', '#f9a8d4', '#86efac', '#fcd34d'];

/**
 * 墙面色阶（顶面 + 侧面）与地面色阶。
 * 地面明显比墙亮：可走区域一眼可辨，墙体则退到暗处，房间轮廓才清楚。
 * （反过来画——亮墙 + 黑地面——整个画面会变成一片亮条纹，没法玩。）
 */
const WALL_TOP = ['#161c2b', '#181e2d', '#1a202f', '#1c2232'];
const WALL_FACE = ['#0b0e17', '#0c0f19', '#0d101b', '#0e111d'];
const FLOOR_FILL = ['#2c3448', '#2f384f', '#323b54', '#353f5a'];

/** 带缓存的小地图：地牢不变时不必每帧重建 */
type MinimapCache = { key: string; canvas: HTMLCanvasElement };

let minimapCache: MinimapCache | null = null;

/** 夹取数值（不引 lib/math，保持渲染层只依赖约定里的 4 个模块） */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function seatColor(seat: number): string {
  const color = SEAT_COLORS[seat];
  return color === undefined ? SEAT_COLORS[0]! : color;
}

/**
 * 世界坐标 → 屏幕坐标。
 * camera 是视口中心，所以屏幕中心对应 camera 所在的世界点。
 */
export function worldToScreen(
  cameraX: number,
  cameraY: number,
  width: number,
  height: number,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: width / 2 + (worldX - cameraX),
    y: height / 2 + (worldY - cameraY),
  };
}

/** 视口中心 → 相机位置：夹在地图内，地图比视口小时直接居中 */
function clampCamera(value: number, viewSize: number, worldSize: number): number {
  if (viewSize >= worldSize) return worldSize / 2;
  return clamp(value, viewSize / 2, worldSize - viewSize / 2);
}

// ---------------------------------------------------------------- 主入口

export function renderGame(options: RenderOptions): void {
  const { ctx, width, height, view, camera, time, damageFlash } = options;

  // 视口外的底色：相机被夹住时理论上不露，留作保险
  ctx.fillStyle = '#090c15';
  ctx.fillRect(0, 0, width, height);

  const camX = clampCamera(camera.x, width, WORLD_W);
  const camY = clampCamera(camera.y, height, WORLD_H);
  const originX = width / 2 - camX;
  const originY = height / 2 - camY;

  ctx.save();
  drawTiles(ctx, view, width, height, originX, originY, time);
  ctx.restore();

  // 实体按「地面物件 → 抛射物 → 怪物 → 玩家」的顺序叠（玩家永远在最上层）
  const minX = camX - width / 2 - 64;
  const maxX = camX + width / 2 + 64;
  const minY = camY - height / 2 - 64;
  const maxY = camY + height / 2 + 64;

  ctx.save();
  for (const item of view.items) {
    if (item.x < minX || item.x > maxX || item.y < minY || item.y > maxY) continue;
    drawItem(ctx, item, originX + item.x, originY + item.y, time);
  }
  for (const projectile of view.projectiles) {
    if (projectile.x < minX || projectile.x > maxX || projectile.y < minY || projectile.y > maxY) continue;
    drawProjectile(ctx, projectile, originX + projectile.x, originY + projectile.y);
  }
  for (const enemy of view.enemies) {
    if (enemy.x < minX || enemy.x > maxX || enemy.y < minY || enemy.y > maxY) continue;
    drawEnemy(ctx, enemy, originX + enemy.x, originY + enemy.y, time);
  }
  for (const player of view.players) {
    if (player.x < minX || player.x > maxX || player.y < minY || player.y > maxY) continue;
    drawPlayer(ctx, player, originX + player.x, originY + player.y, time);
  }
  for (const spark of view.sparks) {
    drawSpark(ctx, spark, originX + spark.x, originY + spark.y);
  }
  for (const float of view.floats) {
    drawFloat(ctx, float, originX + float.x, originY + float.y);
  }
  ctx.restore();

  drawAtmosphere(ctx, width, height, view, originX, originY, damageFlash);
}

// ---------------------------------------------------------------- 瓦片

function drawTiles(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  width: number,
  height: number,
  originX: number,
  originY: number,
  time: number,
): void {
  const grid = view.dungeon.grid;
  const startTx = clamp(toTile(-originX) - 1, 0, MAP_W - 1);
  const endTx = clamp(toTile(width - originX) + 1, 0, MAP_W - 1);
  const startTy = clamp(toTile(-originY) - 1, 0, MAP_H - 1);
  const endTy = clamp(toTile(height - originY) + 1, 0, MAP_H - 1);

  // 相机被夹在地图内，所以可见区间必定与地图相交（上面已经 clamp 过）
  for (let ty = startTy; ty <= endTy; ty += 1) {
    for (let tx = startTx; tx <= endTx; tx += 1) {
      const sx = originX + tx * TILE;
      const sy = originY + ty * TILE;
      const tile = tileAt(grid, tx, ty);
      // 用瓦片坐标做确定性微扰：同一格每帧外观一致，且不需要随机数
      const variant = (tx * 7 + ty * 13) % 4;

      if (tile === T_WALL) {
        drawWallTile(ctx, sx, sy, variant);
      } else if (tile === T_STAIRS) {
        ctx.fillStyle = FLOOR_FILL[variant]!;
        ctx.fillRect(sx, sy, TILE, TILE);
        drawStairsTile(ctx, sx, sy, view.phase === 'cleared', time);
      } else {
        drawFloorTile(ctx, sx, sy, variant);
      }
    }
  }
}

/** 地面：深灰石砖，用 variant 换深浅，再补一层砖缝与高光 */
function drawFloorTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, variant: number): void {
  ctx.fillStyle = FLOOR_FILL[variant]!;
  ctx.fillRect(sx, sy, TILE, TILE);

  // 顶部一道极淡的受光，让地面不至于是一块死板的纯色
  ctx.fillStyle = 'rgba(255,255,255,0.022)';
  ctx.fillRect(sx, sy, TILE, 5);

  // 砖缝：错缝排布（偶数行对齐左边界，奇数行错开半格）
  ctx.fillStyle = 'rgba(8,10,18,0.55)';
  ctx.fillRect(sx, sy + TILE - 2, TILE, 2);
  ctx.fillRect(sx + (variant % 2 === 0 ? 0 : TILE / 2), sy, 2, TILE);
}

/** 墙：整体压暗（顶面稍亮一点暗示厚度），顶部留一条极淡的边把轮廓勾出来 */
function drawWallTile(ctx: CanvasRenderingContext2D, sx: number, sy: number, variant: number): void {
  ctx.fillStyle = WALL_FACE[variant]!;
  ctx.fillRect(sx, sy, TILE, TILE);
  // 顶面：稍亮的一块，制造「有厚度」的立体感
  ctx.fillStyle = WALL_TOP[variant]!;
  ctx.fillRect(sx, sy, TILE, TILE - 7);
  // 顶部高光边（很淡，只用来分辨墙体与通道）
  ctx.fillStyle = 'rgba(150,170,225,0.13)';
  ctx.fillRect(sx, sy, TILE, 3);
  // 底部压暗，和下一行墙面区分开
  ctx.fillStyle = 'rgba(4,6,12,0.6)';
  ctx.fillRect(sx, sy + TILE - 3, TILE, 3);
}

/** 楼梯：向下的台阶；清场后发青光并随 time 呼吸（提示可以下层） */
function drawStairsTile(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  glowing: boolean,
  time: number,
): void {
  const steps = 4;
  const stepH = TILE / steps;
  for (let i = 0; i < steps; i += 1) {
    const inset = i * 2.5;
    const shade = 0.16 + i * 0.13;
    ctx.fillStyle = `rgba(0,0,0,${shade.toFixed(3)})`;
    ctx.fillRect(sx + 3 + inset, sy + i * stepH + 1, TILE - 6 - inset * 2, stepH - 2);
    // 每一级台阶的前沿受光
    ctx.fillStyle = 'rgba(190,210,255,0.10)';
    ctx.fillRect(sx + 3 + inset, sy + i * stepH + 1, TILE - 6 - inset * 2, 1.5);
  }

  if (!glowing) return;
  // 呼吸发光：0.55~1 之间来回
  const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(time * 3.4));
  ctx.strokeStyle = `rgba(103,232,249,${(0.85 * pulse).toFixed(3)})`;
  ctx.lineWidth = 2;
  ctx.strokeRect(sx + 1.5, sy + 1.5, TILE - 3, TILE - 3);
  ctx.fillStyle = `rgba(103,232,249,${(0.16 * pulse).toFixed(3)})`;
  ctx.fillRect(sx + 1, sy + 1, TILE - 2, TILE - 2);
}

// ---------------------------------------------------------------- 玩家

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  player: ViewPlayer,
  x: number,
  y: number,
  time: number,
): void {
  const color = seatColor(player.seat);
  const downed = player.down > 0;

  ctx.save();

  // 本机玩家：脚下一圈白色虚线环（缓慢旋转）
  if (player.isSelf && !downed) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.lineDashOffset = -time * 18;
    ctx.beginPath();
    ctx.arc(x, y + 6, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (downed) {
    // 倒地：压扁 + 半透明，头顶显示复活倒计时
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.ellipse(x, y + 4, 15, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + 2, 13, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.font = 'bold 11px ui-monospace, Menlo, Consolas, monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x - 12, y - 26, 24, 13);
    ctx.fillStyle = '#fca5a5';
    ctx.fillText(player.down.toFixed(1), x, y - 19);
    ctx.restore();
    return;
  }

  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 11, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  // 斗篷
  ctx.fillStyle = 'rgba(15,19,32,0.92)';
  ctx.beginPath();
  ctx.moveTo(x - 10, y + 9);
  ctx.quadraticCurveTo(x, y - 18, x + 10, y + 9);
  ctx.closePath();
  ctx.fill();

  // 圆形身体
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(10,14,24,0.75)';
  ctx.stroke();

  // 朝向：身体前方一小段指示线
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x + player.aimX * 8, y + player.aimY * 8);
  ctx.lineTo(x + player.aimX * 16, y + player.aimY * 16);
  ctx.stroke();
  ctx.lineCap = 'butt';

  // 挥砍弧光：按 attackAnim 比例从起始角扫过，越接近结束越淡
  if (player.attackAnim > 0) {
    const base = Math.atan2(player.aimY, player.aimX);
    const t = clamp(player.attackAnim / 0.16, 0, 1);
    const sweep = Math.PI * 0.75;
    const start = base - sweep * 0.6 + sweep * (1 - t) * 0.9;

    const gradient = ctx.createRadialGradient(x, y, 6, x, y, 30);
    gradient.addColorStop(0, `rgba(255,255,255,${(0.05 * t).toFixed(3)})`);
    gradient.addColorStop(1, `rgba(255,240,200,${(0.75 * t).toFixed(3)})`);
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, 22, start, start + sweep * (0.35 + 0.65 * t));
    ctx.stroke();
  }

  // 受击闪白：hurting 一过 0 就立刻整只变白，末段再淡出
  if (player.hurting > 0) {
    ctx.globalAlpha = clamp(player.hurting * 4, 0.25, 1) * 0.85;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x, y, 10.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 名字：座位色，方便在混战里认出队友
  ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillText(player.name, x + 1, y - 23);
  ctx.fillStyle = color;
  ctx.fillText(player.name, x, y - 24);

  ctx.restore();
}

// ---------------------------------------------------------------- 怪物

function drawEnemy(
  ctx: CanvasRenderingContext2D,
  enemy: ViewEnemy,
  x: number,
  y: number,
  time: number,
): void {
  ctx.save();

  // 地面阴影统一先画，怪物本体再压上去
  if (enemy.kind !== 'bat') {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y + (enemy.kind === 'boss' ? 18 : 10), enemy.kind === 'boss' ? 19 : 10, 4, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  const flash = enemy.hurting > 0;

  switch (enemy.kind) {
    case 'slime':
      drawSlime(ctx, x, y, time, flash);
      break;
    case 'bat':
      drawBat(ctx, x, y, time, flash);
      break;
    case 'mage':
      drawMage(ctx, x, y, time, flash);
      break;
    case 'boss':
      drawBoss(ctx, x, y, time, flash);
      break;
    default:
      break;
  }

  if (enemy.hp < enemy.maxHp) drawHpBar(ctx, x, y - (enemy.kind === 'boss' ? 34 : 18), enemy);
  ctx.restore();
}

/** 绿色果冻：随 time 压扁回弹 + 两只眼睛 */
function drawSlime(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, flash: boolean): void {
  const wobble = Math.sin(time * 2.6);
  const rx = 12 * (1 + wobble * 0.12);
  const ry = 12 * (1 - wobble * 0.12);
  const cy = y + (1 - ry / 12) * 6;

  // 果冻底部一圈反光
  ctx.fillStyle = 'rgba(74,222,128,0.25)';
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 12, 3.5, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = flash ? '#ffffff' : '#4ade80';
  ctx.beginPath();
  ctx.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = flash ? 'rgba(255,255,255,0.9)' : 'rgba(22,101,52,0.9)';
  ctx.stroke();

  // 高光
  ctx.fillStyle = flash ? 'rgba(255,255,255,0.95)' : 'rgba(190,255,214,0.5)';
  ctx.beginPath();
  ctx.ellipse(x - 4, cy - 4.5, 3, 2, -0.5, 0, Math.PI * 2);
  ctx.fill();

  // 眼睛
  ctx.fillStyle = flash ? 'rgba(120,120,140,0.9)' : '#0b1220';
  ctx.beginPath();
  ctx.arc(x - 3.6, cy - 0.6, 1.8, 0, Math.PI * 2);
  ctx.arc(x + 3.6, cy - 0.6, 1.8, 0, Math.PI * 2);
  ctx.fill();
}

/** 深色小蝙蝠：翅膀扇动 */
function drawBat(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, flash: boolean): void {
  const flap = Math.sin(time * 16);
  const cy = y - 1 + Math.sin(time * 3.1) * 2;
  const body = flash ? '#ffffff' : '#3b3f56';
  const wing = flash ? 'rgba(255,255,255,0.9)' : '#262a3d';

  // 翅膀：用二次曲线做出扇动的形状
  for (const dir of [-1, 1]) {
    ctx.fillStyle = wing;
    ctx.beginPath();
    ctx.moveTo(x + dir * 2, cy);
    ctx.quadraticCurveTo(x + dir * 11, cy - 7 - flap * 4, x + dir * 16, cy + 1 - flap * 2);
    ctx.quadraticCurveTo(x + dir * 9, cy + 2 + flap, x + dir * 2, cy + 4);
    ctx.closePath();
    ctx.fill();
  }

  // 身体
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(x, cy + 1, 5, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  // 耳朵 + 眼睛
  ctx.beginPath();
  ctx.moveTo(x - 4, cy - 4);
  ctx.lineTo(x - 2, cy - 9);
  ctx.lineTo(x - 0.5, cy - 4.5);
  ctx.moveTo(x + 4, cy - 4);
  ctx.lineTo(x + 2, cy - 9);
  ctx.lineTo(x + 0.5, cy - 4.5);
  ctx.fill();

  ctx.fillStyle = flash ? '#8888aa' : '#f87171';
  ctx.beginPath();
  ctx.arc(x - 1.8, cy - 1, 1.1, 0, Math.PI * 2);
  ctx.arc(x + 1.8, cy - 1, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

/** 紫色长袍三角 + 手中光球（亮度随 time 呼吸） */
function drawMage(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, flash: boolean): void {
  const bob = Math.sin(time * 2.2) * 1.5;
  const cy = y + bob;

  // 长袍：三角形
  ctx.fillStyle = flash ? '#ffffff' : '#7c3aed';
  ctx.beginPath();
  ctx.moveTo(x, cy - 14);
  ctx.lineTo(x + 12, cy + 10);
  ctx.lineTo(x - 12, cy + 10);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = flash ? 'rgba(255,255,255,0.9)' : 'rgba(49,16,96,0.9)';
  ctx.stroke();

  // 兜帽 + 阴影下的脸
  ctx.fillStyle = flash ? '#ffffff' : '#5b21b6';
  ctx.beginPath();
  ctx.arc(x, cy - 10, 6.5, Math.PI, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = flash ? 'rgba(160,160,190,0.9)' : '#0b0f1c';
  ctx.beginPath();
  ctx.arc(x, cy - 9.5, 3.6, 0, Math.PI * 2);
  ctx.fill();

  // 手中光球：亮度呼吸（不透明色叠加，避免每帧新建渐变）
  const pulse = 0.5 + 0.5 * Math.sin(time * 4.2);
  const ox = x + 11;
  const oy = cy - 3;
  ctx.fillStyle = `rgba(196,132,252,${(0.16 + 0.22 * pulse).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(ox, oy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = `rgba(233,213,255,${(0.7 + 0.3 * pulse).toFixed(3)})`;
  ctx.beginPath();
  ctx.arc(ox, oy, 3.2 + pulse * 0.8, 0, Math.PI * 2);
  ctx.fill();
}

/** 大体型暗红 boss + 两只角 */
function drawBoss(ctx: CanvasRenderingContext2D, x: number, y: number, time: number, flash: boolean): void {
  const breathe = 1 + Math.sin(time * 1.7) * 0.035;
  const r = 22 * breathe;
  const cy = y + 2;

  // 角（先画，压在身体下面）
  ctx.fillStyle = flash ? '#ffffff' : '#e5e7eb';
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(x + dir * (r * 0.55), cy - r * 0.5);
    ctx.quadraticCurveTo(x + dir * (r * 1.1), cy - r * 1.25, x + dir * (r * 0.72), cy - r * 1.7);
    ctx.quadraticCurveTo(x + dir * (r * 0.82), cy - r * 1.05, x + dir * (r * 0.32), cy - r * 0.72);
    ctx.closePath();
    ctx.fill();
  }

  // 身体
  ctx.fillStyle = flash ? '#ffffff' : '#7f1d1d';
  ctx.beginPath();
  ctx.arc(x, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = flash ? 'rgba(255,255,255,0.9)' : '#3f0a0a';
  ctx.stroke();

  // 肩甲/斑纹
  ctx.strokeStyle = flash ? 'rgba(255,255,255,0.7)' : 'rgba(248,113,113,0.55)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, cy, r * 0.62, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();

  // 眼睛：暗红底上一对发亮的黄眼
  ctx.fillStyle = flash ? '#aaaaaa' : '#fbbf24';
  ctx.beginPath();
  ctx.ellipse(x - 8, cy - 3, 3.6, 2.6, -0.25, 0, Math.PI * 2);
  ctx.ellipse(x + 8, cy - 3, 3.6, 2.6, 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#1a0505';
  ctx.beginPath();
  ctx.arc(x - 8, cy - 3, 1.4, 0, Math.PI * 2);
  ctx.arc(x + 8, cy - 3, 1.4, 0, Math.PI * 2);
  ctx.fill();
}

/** 细血条：只在掉血后显示，避免满血时糊一片 */
function drawHpBar(ctx: CanvasRenderingContext2D, cx: number, by: number, enemy: ViewEnemy): void {
  const w = enemy.kind === 'boss' ? 46 : 24;
  const h = enemy.kind === 'boss' ? 5 : 3;
  const x = cx - w / 2;
  const ratio = clamp(enemy.maxHp > 0 ? enemy.hp / enemy.maxHp : 0, 0, 1);

  ctx.fillStyle = 'rgba(6,8,16,0.8)';
  ctx.fillRect(x - 1, by - 1, w + 2, h + 2);
  ctx.fillStyle = ratio > 0.5 ? '#4ade80' : ratio > 0.22 ? '#facc15' : '#ef4444';
  ctx.fillRect(x, by, w * ratio, h);
}

// ---------------------------------------------------------------- 抛射物

function drawProjectile(
  ctx: CanvasRenderingContext2D,
  projectile: ViewProjectile,
  x: number,
  y: number,
): void {
  const enemyShot = projectile.from === 'enemy';
  const core = enemyShot ? '#e9d5ff' : '#ccfbf1';
  const glow = enemyShot ? 'rgba(168,85,247,0.45)' : 'rgba(34,211,238,0.45)';
  const halo = enemyShot ? 'rgba(168,85,247,0.16)' : 'rgba(34,211,238,0.16)';

  // 拖尾：ViewProjectile 只有位置、没有速度，没法判断来向，
  // 所以用「同心淡圆」做出光晕尾巴（比旋转椭圆安全，也不多分配对象）
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fill();

  // 光晕 + 内核（本来想用 shadowBlur，但每个弹丸一次太贵，改成若干层圆）
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, 4.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = core;
  ctx.beginPath();
  ctx.arc(x, y, 2.2, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- 掉落物

function drawItem(ctx: CanvasRenderingContext2D, item: ViewItem, x: number, y: number, time: number): void {
  // ViewItem 没有 bob 字段，用 time + id 做确定性的上下浮动
  const bob = Math.sin(time * 2.8 + item.id * 1.7) * 2.8;
  const iy = y + bob;

  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath();
  ctx.ellipse(x, y + 9, 8, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  switch (item.kind) {
    case 'heart':
      drawHeart(ctx, x, iy);
      break;
    case 'coin':
      drawCoin(ctx, x, iy);
      break;

    case 'potion':
      drawPotion(ctx, x, iy);
      break;
    default:
      break;
  }
  ctx.restore();
}

function drawHeart(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // 两段瓣 + 两条贝塞尔收到底部尖角
  ctx.fillStyle = '#fb7185';
  ctx.beginPath();
  ctx.moveTo(x, y + 5.6);
  ctx.bezierCurveTo(x - 5.2, y + 1, x - 6, y - 2.4, x - 4, y - 4);
  ctx.bezierCurveTo(x - 2.2, y - 5.4, x - 0.4, y - 4, x, y - 2.2);
  ctx.bezierCurveTo(x + 0.4, y - 4, x + 2.2, y - 5.4, x + 4, y - 4);
  ctx.bezierCurveTo(x + 6, y - 2.4, x + 5.2, y + 1, x, y + 5.6);
  ctx.closePath();
  ctx.fill();
  // 高光
  ctx.fillStyle = 'rgba(255,228,235,0.7)';
  ctx.beginPath();
  ctx.arc(x - 2.8, y - 3, 1.3, 0, Math.PI * 2);
  ctx.fill();
}

function drawCoin(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // 用时间的余弦做「翻面」，看起来像旋转的金币
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 1.6;
  ctx.strokeStyle = '#a16207';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,250,214,0.85)';
  ctx.beginPath();
  ctx.arc(x - 1.8, y - 2, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(161,98,7,0.6)';
  ctx.beginPath();
  ctx.arc(x + 1.6, y + 1.8, 1.1, 0, Math.PI * 2);
  ctx.fill();
}

function drawPotion(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  // 瓶身
  ctx.fillStyle = '#38bdf8';
  ctx.beginPath();
  ctx.moveTo(x - 3, y - 1);
  ctx.lineTo(x - 5.5, y + 6);
  ctx.quadraticCurveTo(x, y + 9.5, x + 5.5, y + 6);
  ctx.lineTo(x + 3, y - 1);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = 'rgba(226,242,255,0.75)';
  ctx.stroke();
  // 瓶颈 + 瓶塞
  ctx.fillStyle = 'rgba(186,230,253,0.9)';
  ctx.fillRect(x - 2, y - 6, 4, 5);
  ctx.fillStyle = '#a16207';
  ctx.fillRect(x - 2.6, y - 8.5, 5.2, 3);
  // 液面高光
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.ellipse(x - 1.6, y + 3, 1.1, 2, 0.2, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------- 特效

function drawFloat(ctx: CanvasRenderingContext2D, float: FloatText, x: number, y: number): void {
  const ratio = float.maxLife > 0 ? clamp(float.life / float.maxLife, 0, 1) : 0;
  const size = 11 + ratio * 6;
  ctx.save();
  ctx.globalAlpha = Math.min(1, ratio * 1.6);
  ctx.font = `bold ${size.toFixed(1)}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillText(float.text, x + 1, y + 1);
  ctx.fillStyle = float.color;
  ctx.fillText(float.text, x, y);
  ctx.restore();
}

function drawSpark(ctx: CanvasRenderingContext2D, spark: Spark, x: number, y: number): void {
  const ratio = spark.maxLife > 0 ? clamp(spark.life / spark.maxLife, 0, 1) : 0;
  const size = Math.max(0.5, spark.size * ratio);
  ctx.globalAlpha = ratio;
  ctx.fillStyle = spark.color;
  ctx.fillRect(x - size / 2, y - size / 2, size, size);
  ctx.globalAlpha = 1;
}

// ---------------------------------------------------------------- 氛围（黑暗 + 火把 + 受击闪屏）

function drawAtmosphere(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  view: ViewState,
  originX: number,
  originY: number,
  damageFlash: number,
): void {
  // 光源：本机玩家；找不到就用视口中心
  let lightX = width / 2;
  let lightY = height / 2;
  for (const player of view.players) {
    if (!player.isSelf) continue;
    lightX = originX + player.x;
    lightY = originY + player.y;
    break;
  }

  const radius = Math.max(width, height) * 0.62;
  // 每帧只建一个渐变（实体绘制里一个都不建），这是本文件里唯一的渐变分配
  const gradient = ctx.createRadialGradient(lightX, lightY, radius * 0.22, lightX, lightY, radius);
  gradient.addColorStop(0, 'rgba(4,6,14,0)');
  gradient.addColorStop(0.45, 'rgba(4,6,14,0.30)');
  gradient.addColorStop(1, 'rgba(4,6,14,0.92)');

  ctx.save();
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  if (damageFlash > 0) {
    ctx.fillStyle = `rgba(220,38,38,${(clamp(damageFlash, 0, 1) * 0.35).toFixed(3)})`;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- 小地图

export function renderMinimap(
  ctx: CanvasRenderingContext2D,
  view: ViewState,
  size: number,
  selfSeat: number,
): void {
  const w = Math.max(1, Math.min(size, Math.round((size * MAP_W) / MAP_H)));
  const h = Math.max(1, Math.round((w * MAP_H) / MAP_W));

  // 约定：小地图 canvas 用 1:1 变换（size 就是 CSS 像素），
  // 所以这里把 transform 复位、按 size 清屏；地图按 4:3 居中留边。
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, size, size);

  // 地图像素层按 (seed, floor, 尺寸) 缓存，只有换层才重建
  const key = `${view.dungeon.seed}:${view.dungeon.floor}:${w}x${h}`;
  if (minimapCache === null || minimapCache.key !== key) {
    minimapCache = { key, canvas: buildMinimapCanvas(view, w, h) };
  }

  const ox = Math.round((size - w) / 2);
  const oy = Math.round((size - h) / 2);

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(minimapCache.canvas, ox, oy);

  // 玩家点：座位色；本机玩家更大并套一圈白环
  for (const player of view.players) {
    const px = ox + (player.x / WORLD_W) * w;
    const py = oy + (player.y / WORLD_H) * h;
    const isSelf = player.seat === selfSeat || player.isSelf;
    ctx.fillStyle = seatColor(player.seat);
    const r = isSelf ? 2.6 : 2;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    if (isSelf) {
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      ctx.arc(px, py, 4.2, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
}

function buildMinimapCanvas(view: ViewState, w: number, h: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = MAP_W;
  canvas.height = MAP_H;

  const mapCtx = canvas.getContext('2d');
  if (!mapCtx) return canvas;

  const grid = view.dungeon.grid;
  for (let ty = 0; ty < MAP_H; ty += 1) {
    for (let tx = 0; tx < MAP_W; tx += 1) {
      const tile = tileAt(grid, tx, ty);
      mapCtx.fillStyle = tile === T_WALL ? '#171d2c' : tile === T_STAIRS ? '#22d3ee' : '#495471';
      mapCtx.fillRect(tx, ty, 1, 1);
    }
  }

  // 以 MAP_H 为基准层，再整体拉伸到 w x h
  if (w !== MAP_W || h !== MAP_H) {
    const scaled = document.createElement('canvas');
    scaled.width = w;
    scaled.height = h;
    const scaledCtx = scaled.getContext('2d');
    if (scaledCtx) {
      scaledCtx.imageSmoothingEnabled = false;
      scaledCtx.drawImage(canvas, 0, 0, w, h);
      return scaled;
    }
  }
  return canvas;
}
