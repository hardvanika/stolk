export type Scalar = string | number | null;
export type Row = Record<string, unknown>;

/** Minimal async SQL interface, implemented by op-sqlite on device and node:sqlite in tests. */
export interface SqlDb {
  execute(sql: string, params?: Scalar[]): Promise<{ rows: Row[]; insertId?: number }>;
  /** True when the sqlite-vec extension is available (always on device). */
  readonly hasVec: boolean;
}

export type Coords = { lat: number; lng: number; accuracy?: number | null };
