import { useEffect, useState } from 'react';

/** 应用内使用的路由：'home' 表示首页，其余对应游戏 id。 */
export type RouteInfo = {
  path: string;
  params: URLSearchParams;
};

function readHash(): RouteInfo {
  const raw = window.location.hash.replace(/^#\/?/, '');
  const queryIndex = raw.indexOf('?');
  const path = (queryIndex >= 0 ? raw.slice(0, queryIndex) : raw).trim();
  const query = queryIndex >= 0 ? raw.slice(queryIndex + 1) : '';
  return { path: path === '' ? 'home' : path, params: new URLSearchParams(query) };
}

/**
 * 基于 URL hash 的迷你路由。
 *
 * 之所以不用 react-router 那类需要服务端配合的路由：GitHub Pages 是纯静态托管，
 * 直接访问 /snake 这样的路径会 404。hash 路由（#/snake）完全由浏览器处理，
 * 无论部署在子路径还是自定义域名下都能正常工作。
 *
 * 联机游戏需要携带房间信息，所以支持 `#/gomoku?room=ABCD&role=guest` 这种查询参数。
 */
export function useHashRoute(): {
  path: string;
  params: URLSearchParams;
  navigate: (path: string, params?: Record<string, string>) => void;
} {
  const [route, setRoute] = useState<RouteInfo>(readHash);

  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  useEffect(() => {
    if (window.location.hash === '') {
      window.history.replaceState(null, '', '#/');
    }
  }, []);

  const navigate = (path: string, params?: Record<string, string>) => {
    const search = params ? new URLSearchParams(params).toString() : '';
    const target = path === 'home' ? '/' : `/${path}`;
    window.location.hash = search ? `${target}?${search}` : target;
  };

  return { path: route.path, params: route.params, navigate };
}

/** 只看查询参数（联机组件用它读取房间码），并跟随 hash 变化自动更新。 */
export function useHashParams(): URLSearchParams {
  const [params, setParams] = useState<URLSearchParams>(() => readHash().params);

  useEffect(() => {
    const onChange = () => setParams(readHash().params);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return params;
}

/** 生成指向某个游戏的链接，配合 <a href> 使用。 */
export function gameHref(id: string, params?: Record<string, string>): string {
  const search = params ? new URLSearchParams(params).toString() : '';
  return search ? `#/${id}?${search}` : `#/${id}`;
}
