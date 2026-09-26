import { open } from '@op-engineering/op-sqlite';
import type { Scalar, SqlDb } from './types';
import { migrate } from './schema';

let dbPromise: Promise<SqlDb> | null = null;

/** The single on-device database (app sandbox, never synced anywhere). */
export function getDb(): Promise<SqlDb> {
  dbPromise ??= (async () => {
    const raw = open({ name: 'stolk.db' });
    const db: SqlDb = {
      hasVec: true, // enabled via "op-sqlite": { "sqliteVec": true } in package.json
      async execute(sql: string, params: Scalar[] = []) {
        const r = await raw.execute(sql, params);
        return { rows: r.rows, insertId: r.insertId };
      },
    };
    await migrate(db);
    return db;
  })();
  return dbPromise;
}
