import Dexie, { type EntityTable } from 'dexie';
import { DEFAULT_SLOTS } from '../domain/slots';
import type {
  DoseEvent,
  Medicine,
  Photo,
  Prescription,
  Schedule,
  Settings,
  Slot,
  Symptom,
  Tag,
} from './types';

export const DB_NAME = 'medication-log';

export const DEFAULT_SYMPTOMS = ['어지러움', '두통', '속쓰림', '메스꺼움', '졸림', '피로', '발진', '설사', '변비'];

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  lateNightCutoff: '03:00',
  analysisRange: 7,
  activeAnalysisView: 'charts',
  backupIntervalDays: 30,
  showStockChanges: false,
};

export class MedicationDB extends Dexie {
  medicines!: EntityTable<Medicine, 'id'>;
  slots!: EntityTable<Slot, 'id'>;
  schedules!: EntityTable<Schedule, 'id'>;
  doseEvents!: EntityTable<DoseEvent, 'id'>;
  prescriptions!: EntityTable<Prescription, 'id'>;
  photos!: EntityTable<Photo, 'id'>;
  tags!: EntityTable<Tag, 'id'>;
  symptoms!: EntityTable<Symptom, 'id'>;
  settings!: EntityTable<Settings, 'key'>;

  constructor(name = DB_NAME) {
    super(name);
    this.version(1).stores({
      medicines: '++id, name, active, sortOrder, *tagIds',
      slots: '++id, order',
      schedules: '++id, medicineId, slotId, active, sourcePrescriptionId',
      doseEvents: '++id, date, [date+slotId], medicineId, scheduleId, kind',
      prescriptions: '++id, receivedDate',
      photos: '++id',
      tags: '++id, &name',
      symptoms: '++id, &name',
      settings: '&key',
    });

    // v2: default symptom tags (stage 3). Same stores; seeds symptoms for databases created at v1.
    this.version(2)
      .stores({})
      .upgrade(async (tx) => {
        if ((await tx.table('symptoms').count()) === 0) {
          await tx.table('symptoms').bulkAdd(DEFAULT_SYMPTOMS.map((name) => ({ name })));
        }
      });

    this.on('populate', (tx) => {
      tx.table('slots').bulkAdd(DEFAULT_SLOTS.map((s) => ({ ...s })));
      tx.table('settings').add({ ...DEFAULT_SETTINGS });
      tx.table('symptoms').bulkAdd(DEFAULT_SYMPTOMS.map((name) => ({ name })));
    });
  }
}

export const db = new MedicationDB();
