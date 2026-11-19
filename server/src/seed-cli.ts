// npm run seed: fill an EMPTY database with the prototype's example data (development only).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from './db.js';
import { seedDemo } from './seed.js';

const home = process.env.STOLK_HOME || join(homedir(), '.stolk');
const path = process.env.STOLK_DB || join(home, 'stolk.db');
const db = openDb(path);
try {
  seedDemo(db);
  console.log(`Seeded demo data into ${path}`);
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  db.close();
}
