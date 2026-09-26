import { DatabaseSync } from 'node:sqlite';
import type { Scalar, SqlDb } from '../src/db/types';
import { migrate } from '../src/db/schema';

/** In-memory SQLite with the same schema as the phone (minus sqlite-vec). */
export async function testDb(): Promise<SqlDb> {
  const raw = new DatabaseSync(':memory:');
  const db: SqlDb = {
    hasVec: false,
    async execute(sql: string, params: Scalar[] = []) {
      const stmt = raw.prepare(sql);
      if (stmt.columns().length) return { rows: stmt.all(...params) as Record<string, unknown>[] };
      const r = stmt.run(...params);
      return { rows: [], insertId: Number(r.lastInsertRowid) };
    },
  };
  await migrate(db);
  return db;
}
