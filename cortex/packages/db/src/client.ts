import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "./schema/index.js";
import { runMigrations } from "./migrate.js";

export type CortexDb = ReturnType<typeof drizzle<typeof schema>>;

let dbSingleton: CortexDb | undefined;
let pgliteSingleton: PGlite | undefined;

/**
 * Creates (or returns) the process-wide PGlite-backed Drizzle client.
 * - Production (Render): uses persistent disk at /app/cortex/data
 * - Development: in-memory unless dataDir provided
 * - Tests/seed: pass explicit dataDir
 */
export async function getDb(dataDir?: string): Promise<CortexDb> {
  if (dbSingleton) return dbSingleton;

  // Auto-detect Render persistent disk
  const isProduction = process.env.NODE_ENV === 'production';
  const renderDiskPath = '/app/cortex/data';
  const persistDir = dataDir ?? (isProduction ? renderDiskPath : undefined);

  pgliteSingleton = persistDir ? new PGlite(persistDir) : new PGlite();
  dbSingleton = drizzle(pgliteSingleton, { schema });
  await runMigrations(dbSingleton);
  return dbSingleton;
}

export async function closeDb(): Promise<void> {
  await pgliteSingleton?.close();
  dbSingleton = undefined;
  pgliteSingleton = undefined;
}

export { schema };
