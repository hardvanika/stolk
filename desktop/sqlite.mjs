// SQLite for the desktop app: Node's built-in node:sqlite (bundled with Electron) plus the
// sqlite-vec extension, so the schema, FTS5 search and vector search match the phone exactly.
import { DatabaseSync } from 'node:sqlite';
import { getLoadablePath } from 'sqlite-vec';

// node:sqlite binds every JS number as a REAL, but vec0 only accepts integer rowids.
const bind = (p) => (typeof p === 'number' && Number.isSafeInteger(p) ? BigInt(p) : p);

/** Opens `file` (or ':memory:') and returns an executor with the same shape as SqlDb.execute. */
export function openSqlite(file) {
  const raw = new DatabaseSync(file, { allowExtension: true });
  raw.loadExtension(getLoadablePath());
  raw.enableLoadExtension(false);
  return {
    hasVec: true,
    execute(sql, params = []) {
      const stmt = raw.prepare(sql);
      const args = params.map(bind);
      // node:sqlite returns null-prototype rows; copy them into plain objects before they cross IPC.
      if (stmt.columns().length) return { rows: stmt.all(...args).map((r) => ({ ...r })) };
      const r = stmt.run(...args);
      return { rows: [], insertId: Number(r.lastInsertRowid) };
    },
    close: () => raw.close(),
  };
}
