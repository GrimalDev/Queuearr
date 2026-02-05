import { defineConfig } from 'drizzle-kit';
import { join } from 'path';

const DATA_DIR = process.env.QUEUEARR_DATA_DIR || join(process.cwd(), 'data');

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: join(DATA_DIR, 'queuearr.db'),
  },
});
