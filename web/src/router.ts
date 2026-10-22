import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { page: 'today' }
  | { page: 'medicines' }
  | { page: 'prescriptions' }
  | { page: 'analysis' }
  | { page: 'more' }
  | { page: 'slots' };

const PAGES = new Set<Route['page']>(['today', 'medicines', 'prescriptions', 'analysis', 'more', 'slots']);

export function parseHash(hash: string): Route {
  const page = hash.replace(/^#\/?/, '').split('/')[0];
  return PAGES.has(page as Route['page']) ? ({ page } as Route) : { page: 'today' };
}

export function href(route: Route): string {
  return `#/${route.page}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
