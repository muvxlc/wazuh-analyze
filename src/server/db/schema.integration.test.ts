import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  createTestPool,
} from "../../test/postgres/database";
import {
  applicationTables,
  resetTestDatabase,
} from "../../test/postgres/reset";

const expectedIndexes = [
  "alerts_agent_idx",
  "alerts_cursor_idx",
  "alerts_fingerprint_unique",
  "alerts_level_idx",
  "alerts_rule_idx",
  "alerts_status_idx",
  "alerts_wazuh_event_id_unique",
  "vulnerability_analyses_agent_source_created_idx",
  "vulnerability_analyses_created_idx",
  "sessions_token_hash_unique",
  "users_normalized_email_unique",
  "source_coverage_source_key_unique",
  "source_coverage_key_idx",
  "source_coverage_type_idx",
  "source_coverage_enabled_idx",
  "source_coverage_freshness_idx",
  "evidence_records_alert_idx",
  "evidence_records_incident_idx",
  "evidence_records_type_idx",
  "evidence_records_created_idx",
  "evidence_records_provenance_idx",
  "dead_letters_status_idx",
  "dead_letters_source_idx",
];

describe("PostgreSQL schema", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = createTestPool();
  });

  beforeEach(async () => {
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates every application table and PostgreSQL enum", async () => {
    const tables = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    const enums = await pool.query<{ typname: string }>(
      `SELECT typname
       FROM pg_type
       WHERE typtype = 'e'
       ORDER BY typname`,
    );

    expect(tables.rows.map(({ table_name }) => table_name)).toEqual(
      expect.arrayContaining([...applicationTables]),
    );
    expect(enums.rows.map(({ typname }) => typname)).toEqual(
      expect.arrayContaining([
        "alert_status",
        "locale",
        "notification_event_type",
        "override_effect",
        "role",
      ]),
    );
  });

  it("enforces normalized email uniqueness", async () => {
    await pool.query(
      `INSERT INTO users (email, normalized_email, display_name, password_hash)
       VALUES ($1, $2, $3, $4)`,
      ["admin@example.com", "admin@example.com", "Admin", "hash-1"],
    );

    await expect(
      pool.query(
        `INSERT INTO users (email, normalized_email, display_name, password_hash)
         VALUES ($1, $2, $3, $4)`,
        ["ADMIN@example.com", "admin@example.com", "Other", "hash-2"],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("enforces one alert deduplication identity", async () => {
    await pool.query(
      `INSERT INTO alerts
         (wazuh_event_id, fingerprint, wazuh_timestamp, rule_description, level, raw_payload)
       VALUES ($1, $2, NOW(), $3, $4, $5)`,
      ["evt-1", "fp-1", "First", 5, {}],
    );

    await expect(
      pool.query(
        `INSERT INTO alerts
           (wazuh_event_id, fingerprint, wazuh_timestamp, rule_description, level, raw_payload)
         VALUES ($1, $2, NOW(), $3, $4, $5)`,
        ["evt-1", "fp-2", "Duplicate event", 6, {}],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await expect(
      pool.query(
        `INSERT INTO alerts
           (wazuh_event_id, fingerprint, wazuh_timestamp, rule_description, level, raw_payload)
         VALUES ($1, $2, NOW(), $3, $4, $5)`,
        ["evt-2", "fp-1", "Duplicate fingerprint", 7, {}],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });

  it("creates required operational indexes", async () => {
    const result = await pool.query<{ indexname: string }>(
      `SELECT indexname
       FROM pg_indexes
       WHERE schemaname = 'public'`,
    );

    expect(result.rows.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining(expectedIndexes),
    );
  });

  it("uses timezone-aware timestamps", async () => {
    const result = await pool.query<{ data_type: string }>(
      `SELECT data_type
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND column_name IN ('created_at', 'updated_at', 'expires_at', 'ingested_at', 'occurred_at')`,
    );

    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map(({ data_type }) => data_type))).toEqual(
      new Set(["timestamp with time zone"]),
    );
  });
});

describe("resetTestDatabase", () => {
  it("refuses databases not explicitly named for tests", async () => {
    const pool = new Pool({
      connectionString: "postgresql://localhost/wazuh_dashboard",
    });

    await expect(resetTestDatabase(pool)).rejects.toThrow("without _test");

    await pool.end();
  });
});
