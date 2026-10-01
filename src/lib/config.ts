/**
 * 运行时配置。
 *
 * Supabase 的 anon key 本来就设计成随前端一起公开（它只代表「匿名访客」身份，
 * 真正的权限由数据库策略控制）。本项目只用 Realtime 的广播和在线状态，
 * 不建表、不存数据，所以把 key 放进前端产物里没有额外的数据风险。
 *
 * 但为了便于轮换，仍然通过环境变量注入：
 *   本地开发：.env.local
 *   线上构建：GitHub Actions 的 Secrets（工作流里注入）
 */
const rawUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const rawKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

/**
 * 地址是否可用：正式环境必须是 https；
 * 另外放行本机 http 端点，方便自托管 Supabase 或本地联调测试。
 */
function isUsableUrl(url: string): boolean {
  if (url.startsWith('https://')) return true;
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/.*)?$/i.test(url);
}

export const supabaseConfig = {
  url: rawUrl,
  key: rawKey,
  /** 是否拿到了可用的 Supabase 配置 */
  configured: isUsableUrl(rawUrl) && rawKey.length > 20,
};

export type NetMode = 'supabase' | 'local';

/**
 * 允许用 URL 参数强制指定传输方式，主要用于测试和排查：
 *   #/gomoku?room=ABCD&net=local
 */
export function netModeFromLocation(search: string): NetMode | null {
  const params = new URLSearchParams(search);
  const value = params.get('net');
  if (value === 'local' || value === 'supabase') return value;
  return null;
}
