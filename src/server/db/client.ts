import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";
import type { Database } from "./types";

export function createDatabase(connectionString: string): {
  db: Database;
  pool: Pool;
} {
  const pool = new Pool({ connectionString });

  return {
    db: drizzle(pool, { schema }),
    pool,
  };
}
