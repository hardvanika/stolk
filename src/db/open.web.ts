import type { SqlDb } from './types';
import { migrate } from './schema';
import { desktop } from '../desktop/bridge';

let dbPromise: Promise<SqlDb> | null = null;

/** Desktop: the same schema in a SQLite file owned by the Electron main process (desktop/sqlite.mjs). */
export function getDb(): Promise<SqlDb> {
  dbPromise ??= (async () => {
    const db: SqlDb = {
      hasVec: true, // sqlite-vec is loaded by the main process
      execute: (sql, params = []) => desktop().execute(sql, params),
    };
    await migrate(db);
    return db;
  })();
  return dbPromise;
}
