import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AlgorithmSettings } from "../config/algorithms";
import {
  deserializeGraphPayload,
  serializeGraphPayload,
} from "./serialization";

interface ThoughtFieldDB extends DBSchema {
  meta: {
    key: string;
    value: unknown;
  };
  graph: {
    key: string;
    value: unknown;
  };
  settings: {
    key: string;
    value: AlgorithmSettings;
  };
}

const DB_NAME = "thoughtfield";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<ThoughtFieldDB>> | null = null;

function getDb(): Promise<IDBPDatabase<ThoughtFieldDB>> {
  if (!dbPromise) {
    dbPromise = openDB<ThoughtFieldDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("meta")) {
          db.createObjectStore("meta");
        }
        if (!db.objectStoreNames.contains("graph")) {
          db.createObjectStore("graph");
        }
        if (!db.objectStoreNames.contains("settings")) {
          db.createObjectStore("settings");
        }
      },
    });
  }
  return dbPromise;
}

export async function saveGraphState(payload: {
  nodes: Array<Record<string, unknown>>;
  edges: unknown[];
  communities: Array<Record<string, unknown>>;
  occurrences: Array<Record<string, unknown>>;
  settings: AlgorithmSettings;
  committedTranscript: string;
  sequenceIndex: number;
}): Promise<void> {
  const db = await getDb();
  const serialized = serializeGraphPayload(payload);
  await db.put("graph", serialized, "snapshot");
  await db.put("settings", payload.settings, "current");
}

export async function loadGraphState(): Promise<ReturnType<
  typeof deserializeGraphPayload
> | null> {
  const db = await getDb();
  const raw = await db.get("graph", "snapshot");
  if (!raw) {
    return null;
  }
  return deserializeGraphPayload(raw);
}

export async function clearPersistedState(): Promise<void> {
  const db = await getDb();
  await db.clear("graph");
  await db.clear("settings");
}
