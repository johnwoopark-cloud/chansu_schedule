// Data model for the medication log. Mirrors docs/medication-tracker-plan.md §5.
// Dates are local calendar dates ("2026-10-22"); times of day are "HH:MM"; timestamps are epoch ms.

export type ISODate = string;
export type TimeOfDay = string;

export interface Medicine {
  id?: number;
  name: string;
  notes: string;
  color: string;
  useColor: boolean;
  icon: string;
  sortOrder: number;
  active: boolean;
  strength?: number;
  strengthUnit?: string;
  /** When true, taken doses are deducted from stockAmount. */
  trackStock?: boolean;
  stockAmount: number;
  stockUnit: string;
  refillSizes: number[];
  stockThreshold: number;
  productionDate?: ISODate;
  expirationDate?: ISODate;
  halfLifeHours?: number;
  timeToPeakHours?: number;
  cannotBeSkipped: boolean;
  tagIds: number[];
}

export interface Slot {
  id?: number;
  label: string;
  time: TimeOfDay;
  order: number;
  packetStock?: number;
}

export type ScheduleType = 'TIME' | 'CONTINUOUS_INTERVAL' | 'WINDOWED_INTERVAL' | 'LINKED';

export interface Schedule {
  id?: number;
  medicineId: number;
  type: ScheduleType;
  slotId?: number;
  timeOfDay?: TimeOfDay;
  doseQty: number;
  doseUnit: string;
  variableAmount: boolean;
  autoTaken: boolean;
  instructions: string;
  active: boolean;
  /** Sunday-first, like Date.getDay(). */
  weekdays: boolean[];
  /** Bit n set = active on day n+1 of the month. 0 = no restriction. */
  monthDays: number;
  periodStart?: ISODate;
  periodEnd?: ISODate;
  cycle?: { startDate: ISODate; activeDays: number; pauseDays: number };
  interval?: { minutes: number; startAt: number; fromProcessed: boolean };
  window?: { start: TimeOfDay; end: TimeOfDay };
  linked?: { parentScheduleId: number; delayMinutes: number };
  sourcePrescriptionId?: number;
}

export type DoseEventKind = 'SCHEDULED' | 'EXTRA' | 'REFILL' | 'STOCK_ADJUST';
export type DoseStatus = 'TAKEN' | 'SKIPPED';

export interface DoseEvent {
  id?: number;
  scheduleId?: number;
  medicineId: number;
  kind: DoseEventKind;
  date: ISODate;
  slotId?: number;
  scheduledAt?: number;
  processedAt?: number;
  status: DoseStatus;
  snapshot: {
    medicineName: string;
    strength?: number;
    strengthUnit?: string;
    doseQty: number;
    doseUnit: string;
    color?: string;
    tags: string[];
  };
  stockBefore?: number;
  stockAfter?: number;
  /** Amount this record currently takes out of the medicine's stock (0/undefined = none). */
  stockDeducted?: number;
  /** For LINKED schedules: the parent dose record this one follows. */
  linkedEventId?: number;
  /** Recorded automatically by an "auto taken" schedule, not confirmed by the user. */
  auto?: boolean;
  note?: string;
  symptomIds: number[];
}

export interface Prescription {
  id?: number;
  receivedDate: ISODate;
  hospital?: string;
  pharmacy?: string;
  days?: number;
  note?: string;
  items: { medicineId: number; quantity: number }[];
  packets: { slotId: number; count: number }[];
  photoIds: number[];
}

export interface Photo {
  id?: number;
  blob: Blob;
  mimeType: string;
  createdAt: number;
}

export interface Tag {
  id?: number;
  name: string;
}

export interface Symptom {
  id?: number;
  name: string;
}

export type AnalysisView = 'charts' | 'table' | 'calendar' | 'concentration';

export interface Settings {
  key: 'app';
  lateNightCutoff: TimeOfDay;
  analysisRange: number;
  activeAnalysisView: AnalysisView;
  backupIntervalDays: number;
  /** Warn when stock covers this many days or fewer. */
  lowStockDays?: number;
  /** Weekend mode: on these weekdays (Sunday-first), clock-time doses from `from` (default 00:00) until `time` move to `time`. */
  weekendShift?: { weekdays: boolean[]; time: TimeOfDay; from?: TimeOfDay };
  /** Auto-taken schedules have been processed up to this timestamp. */
  lastAutoTakenAt?: number;
  lastBackupAt?: number;
  pinHash?: string;
  showStockChanges: boolean;
}
