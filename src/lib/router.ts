import { useEffect, useState } from 'react';

/** 应用内使用的路由名：'home' 表示首页，其余对应游戏 id。 */
export type RouteName = string;

function readRoute(): RouteName {
  const raw = window.location.hash.replace(/^#\/?/, '').trim();
  return raw === '' ? 'home' : raw;
}

/**
 * 基于 URL hash 的迷你路由。
 *
 * 之所以不用 react-router 那类需要服务端配合的路由：GitHub Pages 是纯静态托管，
 * 直接访问 /snake 这样的路径会 404。hash 路由（#/snake）完全由浏览器处理，
 * 无论部署在子路径还是自定义域名下都能正常工作。
 */
export function useHashRoute(): [RouteName, (route: RouteName) => void] {
  const [route, setRoute] = useState<RouteName>(readRoute);

  useEffect(() => {
    const onChange = () => setRoute(readRoute());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    // 保证地址栏里始终有 hash，刷新时才能停在同一页
    if (window.location.hash === '') {
      window.history.replaceState(null, '', '#/');
    }
  }, []);

  const navigate = (next: RouteName) => {
    window.location.hash = next === 'home' ? '/' : `/${next}`;
  };

  return [route, navigate];
}

/** 生成指向某个游戏的链接，配合 <a href> 使用。 */
export function gameHref(id: string): string {
  return `#/${id}`;
}
