// Local storage on this device only (IndexedDB via Dexie). Nothing here leaves the device
// unless the user exports it. Why not localStorage: ~5 MB cap and synchronous writes; one
// minute of raw samples is already ~300 KB.
import Dexie, { type EntityTable } from "dexie";
import type { CustomSign } from "./asl/customSigns";
import type { Template } from "./gesture/classifier";
import type { Recording } from "./sensor/recording";

export interface RecordingRow extends Recording {
  id?: number;
  name: string;
}

/** One "app angle vs protractor angle" pair from the validation helper. */
export interface ValidationRow {
  id?: number;
  createdAt: string;
  exercise: string;
  device: string;
  appDeg: number;
  refDeg: number;
}

/** Small key-value settings, e.g. the limits last used in phone-only mode. */
export interface SettingRow {
  key: string;
  value: unknown;
}

/** One prompt in the Mode 2 "Uji" test: what was asked vs what the app said. */
export interface GestureTestRow {
  id?: number;
  runId: string;
  createdAt: string;
  expected: string;
  predicted: string | null; // null = rejected ("tidak dikenali")
  latencyMs: number;
}

/** Settings key shared by both Mode 2 tabs (fills "nama saya ..."). */
export const USER_NAME_KEY = "user-name";

type RehatDb = Dexie & {
  aslCustom: EntityTable<CustomSign, "id">;
  templates: EntityTable<Template, "id">;
  gestureTests: EntityTable<GestureTestRow, "id">;
  settings: EntityTable<SettingRow, "key">;
  recordings: EntityTable<RecordingRow, "id">;
  validations: EntityTable<ValidationRow, "id">;
};

let db: RehatDb | null = null;

/** Lazy, so server rendering never touches IndexedDB. */
export function getDb(): RehatDb {
  if (!db) {
    db = new Dexie("rehat-prototype") as RehatDb;
    db.version(1).stores({
      recordings: "++id, createdAt",
      validations: "++id, createdAt",
    });
    db.version(2).stores({ settings: "key" });
    db.version(3).stores({
      templates: "++id, word",
      gestureTests: "++id, runId",
    });
    db.version(4).stores({ aslCustom: "++id, key" }); // user-recorded ASL words
  }
  return db;
}
