import type { DoseEvent, ISODate, Medicine, Schedule } from '../db/types';
import type { PlanGroup } from './dayPlan';
import { timeToMinutes } from './slots';

export type DoseState = 'pending' | 'taken' | 'skipped';

export interface DoseRow {
  schedule: Schedule;
  medicine: Medicine;
  event?: DoseEvent;
  state: DoseState;
}

export interface GroupView {
  key: string;
  label: string;
  time: string;
  isSlot: boolean;
  rows: DoseRow[];
  taken: number;
  skipped: number;
  pending: number;
  /** Time has passed (today) or the day is over (past day) with doses still unchecked. */
  overdue: boolean;
}

export interface DayView {
  groups: GroupView[];
  /** Extra doses and scheduled records that no longer match the plan (schedule changed or deleted). */
  others: DoseEvent[];
  totals: { taken: number; skipped: number; pending: number };
}

export type Timing = { kind: 'past' } | { kind: 'today'; minutesIntoDay: number } | { kind: 'future' };

/** Merges the planned doses for a day with the recorded events. */
export function buildDayView(plan: readonly PlanGroup[], events: readonly DoseEvent[], timing: Timing): DayView {
  const bySchedule = new Map<number, DoseEvent>();
  for (const e of events) {
    if (e.kind === 'SCHEDULED' && e.scheduleId !== undefined) bySchedule.set(e.scheduleId, e);
  }
  const used = new Set<DoseEvent>();

  const groups = plan.map((g): GroupView => {
    const rows = g.doses.map(({ schedule, medicine }): DoseRow => {
      const event = bySchedule.get(schedule.id!);
      if (event) used.add(event);
      const state: DoseState = event ? (event.status === 'TAKEN' ? 'taken' : 'skipped') : 'pending';
      return { schedule, medicine, event, state };
    });
    const count = (s: DoseState) => rows.filter((r) => r.state === s).length;
    const pending = count('pending');
    const timePassed =
      timing.kind === 'past' || (timing.kind === 'today' && timing.minutesIntoDay > timeToMinutes(g.time));
    return {
      key: g.key,
      label: g.slot?.label ?? '',
      time: g.time,
      isSlot: !!g.slot,
      rows,
      taken: count('taken'),
      skipped: count('skipped'),
      pending,
      overdue: pending > 0 && timePassed,
    };
  });

  const others = events
    .filter((e) => !used.has(e) && (e.kind === 'EXTRA' || e.kind === 'SCHEDULED'))
    .sort((a, b) => (a.processedAt ?? 0) - (b.processedAt ?? 0));
  const sum = (k: 'taken' | 'skipped' | 'pending') => groups.reduce((n, g) => n + g[k], 0);
  return { groups, others, totals: { taken: sum('taken'), skipped: sum('skipped'), pending: sum('pending') } };
}

export function timingFor(date: ISODate, today: ISODate, minutesIntoToday: number): Timing {
  if (date < today) return { kind: 'past' };
  if (date > today) return { kind: 'future' };
  return { kind: 'today', minutesIntoDay: minutesIntoToday };
}

export type StateFilter = 'all' | 'pending' | 'done';

/** Applies the Today filters; groups left with no rows are dropped. */
export function filterDayView(
  groups: readonly GroupView[],
  state: StateFilter,
  tagId: number | null,
): GroupView[] {
  return groups
    .map((g) => ({
      ...g,
      rows: g.rows.filter(
        (r) =>
          (state === 'all' || (state === 'pending') === (r.state === 'pending')) &&
          (tagId === null || r.medicine.tagIds.includes(tagId)),
      ),
    }))
    .filter((g) => g.rows.length > 0);
}
