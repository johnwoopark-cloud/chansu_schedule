import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { page: 'today' }
  | { page: 'medicines' }
  | { page: 'medicine'; id: number | 'new' }
  | { page: 'medicine-calendar'; id: number }
  | { page: 'schedule'; medicineId: number; id: number | 'new' }
  | { page: 'prescriptions' }
  | { page: 'prescription'; id: number | 'new' }
  | { page: 'analysis' }
  | { page: 'more' }
  | { page: 'slots' }
  | { page: 'symptoms' }
  | { page: 'record-settings' };

function parseId(value: string | undefined): number | 'new' | null {
  if (value === 'new') return 'new';
  if (value && /^\d+$/.test(value)) return Number(value);
  return null;
}

/**
 * Routes:
 *   #/today  #/medicines  #/medicines/new  #/medicines/12
 *   #/medicines/12/schedules/new  #/medicines/12/schedules/5  #/medicines/12/calendar
 *   #/prescriptions  #/prescriptions/new  #/prescriptions/3  #/analysis  #/more  #/slots  #/symptoms  #/record-settings
 */
export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  switch (parts[0]) {
    case 'medicines': {
      if (parts.length === 1) return { page: 'medicines' };
      const id = parseId(parts[1]);
      if (id === null) break;
      if (parts.length === 2) return { page: 'medicine', id };
      if (parts[2] === 'calendar' && typeof id === 'number' && parts.length === 3) return { page: 'medicine-calendar', id };
      const scheduleId = parseId(parts[3]);
      if (parts[2] === 'schedules' && typeof id === 'number' && scheduleId !== null && parts.length === 4) {
        return { page: 'schedule', medicineId: id, id: scheduleId };
      }
      break;
    }
    case 'prescriptions': {
      if (parts.length === 1) return { page: 'prescriptions' };
      const id = parseId(parts[1]);
      if (id !== null && parts.length === 2) return { page: 'prescription', id };
      break;
    }
    case 'analysis':
    case 'more':
    case 'slots':
    case 'symptoms':
    case 'record-settings':
    case 'today':
      if (parts.length === 1) return { page: parts[0] };
      break;
  }
  return { page: 'today' };
}

export function href(route: Route): string {
  switch (route.page) {
    case 'medicine':
      return `#/medicines/${route.id}`;
    case 'schedule':
      return `#/medicines/${route.medicineId}/schedules/${route.id}`;
    case 'medicine-calendar':
      return `#/medicines/${route.id}/calendar`;
    case 'prescription':
      return `#/prescriptions/${route.id}`;
    default:
      return `#/${route.page}`;
  }
}

export function navigate(route: Route, replace = false): void {
  if (replace) location.replace(href(route));
  else location.hash = href(route);
}

// Hash of the page we came from, so "back" can pop history instead of stacking duplicates.
let previousHash: string | null = null;

/** Uses the event's oldURL: two navigations in one tick fire two events that both see the final location.hash. */
export function trackHashChange(event: HashChangeEvent): void {
  previousHash = new URL(event.oldURL).hash;
}

/**
 * Returns to `route`: pops history when that is where we came from (so the
 * Android back button doesn't revisit pages), otherwise replaces the current entry.
 */
export function goBackTo(route: Route): void {
  const target = href(route);
  if (previousHash !== null && parseHashKey(previousHash) === parseHashKey(target)) history.back();
  else location.replace(target);
}

function parseHashKey(hash: string): string {
  return href(parseHash(hash));
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const onChange = (event: HashChangeEvent) => {
      trackHashChange(event);
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
