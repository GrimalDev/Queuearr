import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import * as schema from './schema';

const DATA_DIR = process.env.QUEUEARR_DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'queuearr.db');

function initializeDatabase() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');

  const database = drizzle(sqlite, { schema });

  migrate(database, { migrationsFolder: './drizzle' });

  return database;
}

export const db = initializeDatabase();
export { schema };

import '@/lib/download-watcher';
