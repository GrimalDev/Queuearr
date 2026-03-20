import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { join } from 'path';
import { existsSync, mkdirSync, readdirSync, writeFileSync, unlinkSync, readFileSync } from 'fs';
import * as schema from './schema';

const DATA_DIR = process.env.QUEUEARR_DATA_DIR || join(process.cwd(), 'data');
const DB_PATH = join(DATA_DIR, 'queuearr.db');
const MIGRATION_LOCK = join(DATA_DIR, '.migration.lock');
const DB_SINGLETON_KEY = '__queuearrDbSingleton';

function acquireMigrationLock(): boolean {
  try {
    if (existsSync(MIGRATION_LOCK)) {
      const lockContent = readFileSync(MIGRATION_LOCK, 'utf-8');
      const lockPid = parseInt(lockContent, 10);
      
      try {
        process.kill(lockPid, 0);
        return false;
      } catch {
        console.log('[DB] Stale lock detected, removing');
        unlinkSync(MIGRATION_LOCK);
      }
    }
    
    writeFileSync(MIGRATION_LOCK, process.pid.toString(), { flag: 'wx' });
    return true;
  } catch {
    return false;
  }
}

function releaseMigrationLock(): void {
  try {
    if (existsSync(MIGRATION_LOCK)) {
      const lockContent = readFileSync(MIGRATION_LOCK, 'utf-8');
      if (parseInt(lockContent, 10) === process.pid) {
        unlinkSync(MIGRATION_LOCK);
      }
    }
  } catch (error) {
    console.error('[DB] Failed to release migration lock:', error);
  }
}

function initializeDatabase() {
  if (process.env.NEXT_PHASE === 'phase-production-build') {
    console.log('[DB] Using in-memory database for build phase');
    const sqlite = new Database(':memory:');
    return drizzle(sqlite, { schema });
  }

  console.log('[DB] Initializing database...');
  console.log('[DB] Data directory:', DATA_DIR);
  console.log('[DB] Database path:', DB_PATH);

  if (!existsSync(DATA_DIR)) {
    console.log('[DB] Creating data directory:', DATA_DIR);
    mkdirSync(DATA_DIR, { recursive: true });
  }

  const dbExists = existsSync(DB_PATH);
  console.log('[DB] Database file exists:', dbExists);

  const sqlite = new Database(DB_PATH);
  sqlite.pragma('journal_mode = WAL');

  const database = drizzle(sqlite, { schema });

  const hasLock = acquireMigrationLock();
  
  if (hasLock) {
    const getAppliedMigrations = () => {
      try {
        const result = sqlite.prepare('SELECT * FROM __drizzle_migrations ORDER BY created_at').all() as Array<{ hash: string; created_at: number }>;
        return result;
      } catch {
        return [];
      }
    };

    const appliedMigrations = getAppliedMigrations();
    console.log('[DB] Applied migrations count:', appliedMigrations.length);

    const migrationsFolder = './drizzle';
    const availableMigrations = existsSync(migrationsFolder) 
      ? readdirSync(migrationsFolder).filter(f => f.endsWith('.sql')).length 
      : 0;
    console.log('[DB] Available migrations:', availableMigrations);

    const pendingCount = availableMigrations - appliedMigrations.length;
    if (pendingCount > 0) {
      console.log('[DB] Pending migrations:', pendingCount);
    } else if (pendingCount === 0) {
      console.log('[DB] No new migrations to apply');
    }

    console.log('[DB] Running migrations from ./drizzle...');
    try {
      migrate(database, { migrationsFolder: './drizzle' });
      
      const updatedMigrations = getAppliedMigrations();
      const newlyApplied = updatedMigrations.length - appliedMigrations.length;
      
      if (newlyApplied > 0) {
        console.log('[DB] Successfully applied', newlyApplied, 'new migration(s)');
      } else {
        console.log('[DB] Database is up to date');
      }
    } catch (error) {
      console.error('[DB] Migration failed:', error);
      releaseMigrationLock();
      throw error;
    }
    
    releaseMigrationLock();
  } else {
    console.log('[DB] Another process is running migrations, waiting...');
    let attempts = 0;
    while (existsSync(MIGRATION_LOCK) && attempts < 30) {
      attempts++;
      const start = Date.now();
      while (Date.now() - start < 1000) {
        // Busy wait for 1 second
      }
    }
    
    if (existsSync(MIGRATION_LOCK)) {
      console.warn('[DB] Migration lock timeout - proceeding anyway');
    } else {
      console.log('[DB] Migrations completed by another process');
    }
  }

  console.log('[DB] Database initialized successfully');
  return database;
}

type QueuearrDatabase = ReturnType<typeof initializeDatabase>;

type GlobalDatabaseState = {
  [DB_SINGLETON_KEY]?: QueuearrDatabase;
};

const globalDatabaseState = globalThis as typeof globalThis & GlobalDatabaseState;

function getDatabaseSingleton(): QueuearrDatabase {
  const existingDatabase = globalDatabaseState[DB_SINGLETON_KEY];
  if (existingDatabase) {
    return existingDatabase;
  }

  const database = initializeDatabase();
  globalDatabaseState[DB_SINGLETON_KEY] = database;
  return database;
}

export const db = getDatabaseSingleton();
export { schema };
