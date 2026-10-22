import { describe, expect, it } from 'vitest';
import { href, parseHash, type Route } from '../src/router';

describe('router', () => {
  it('parses known routes', () => {
    expect(parseHash('')).toEqual({ page: 'today' });
    expect(parseHash('#/medicines')).toEqual({ page: 'medicines' });
    expect(parseHash('#/medicines/new')).toEqual({ page: 'medicine', id: 'new' });
    expect(parseHash('#/medicines/12')).toEqual({ page: 'medicine', id: 12 });
    expect(parseHash('#/medicines/12/schedules/new')).toEqual({ page: 'schedule', medicineId: 12, id: 'new' });
    expect(parseHash('#/medicines/12/schedules/5')).toEqual({ page: 'schedule', medicineId: 12, id: 5 });
    expect(parseHash('#/slots')).toEqual({ page: 'slots' });
  });

  it('falls back to today for anything else', () => {
    for (const bad of ['#/nope', '#/medicines/abc', '#/medicines/new/schedules/1', '#/medicines/1/x/2', '#/more/1']) {
      expect(parseHash(bad)).toEqual({ page: 'today' });
    }
  });

  it('round-trips', () => {
    const routes: Route[] = [
      { page: 'today' },
      { page: 'medicine', id: 3 },
      { page: 'schedule', medicineId: 3, id: 'new' },
      { page: 'slots' },
    ];
    for (const r of routes) expect(parseHash(href(r))).toEqual(r);
  });
});
