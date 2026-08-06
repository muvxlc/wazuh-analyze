import { Pool } from "pg";

export const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:55432/wazuh_dashboard_test";

export function createTestPool(): Pool {
  return new Pool({ connectionString: testDatabaseUrl, max: 1 });
}
