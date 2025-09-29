import Dexie, { Table } from 'dexie';
import type { LayoutSnapshot } from './types';

export interface LayoutRow {
  name: string;              // уникальное имя варианта (ключ)
  snapshot: LayoutSnapshot;  // узлы + связи + опции
  createdAt: number;
  updatedAt: number;
}

class SankeyDB extends Dexie {
  layouts!: Table<LayoutRow, string>;
  constructor() {
    super('sankey_ts_db');
    this.version(1).stores({
      layouts: 'name, updatedAt'
    });
  }
}

const db = new SankeyDB();

/** API */
export async function dbSaveLayout(name: string, snapshot: LayoutSnapshot) {
  const now = Date.now();
  await db.layouts.put({
    name,
    snapshot,
    createdAt: now,
    updatedAt: now
  });
}

export async function dbListLayouts(): Promise<string[]> {
  const all = await db.layouts.orderBy('updatedAt').reverse().toArray();
  return all.map(r => r.name);
}

export async function dbGetLayout(name: string): Promise<LayoutSnapshot | null> {
  const row = await db.layouts.get(name);
  return row?.snapshot ?? null;
}

export async function dbDeleteLayout(name: string) {
  await db.layouts.delete(name);
}

export default db;
