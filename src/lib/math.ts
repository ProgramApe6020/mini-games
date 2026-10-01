/** 通用小工具（纯函数，不含 DOM）。 */

/** 把数值限制在 [min, max] 区间内。 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
