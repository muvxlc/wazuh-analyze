import { beforeEach, describe, expect, it, afterAll } from "vitest";

import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../db/schema";
import type { Database } from "../db/types";
import { createTestPool } from "../../test/postgres/database";
import { resetTestDatabase } from "../../test/postgres/reset";
import {
  upsertSourceCoverage,
  recordIngestSuccess,
  recordIngestFailure,
  setSourceEnabled,
  setFreshnessSla,
  listStaleSources,
  listSourceCoverage,
} from "./service";

describe("source-coverage service", () => {
  let db: Database;
  let pool: ReturnType<typeof createTestPool>;

  beforeEach(async () => {
    pool = createTestPool();
    db = drizzle(pool, { schema });
    await resetTestDatabase(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  const base = {
    credentialScope: "api-key-in-env",
  };

  it("inserts a coverage entry and returns expected fields", async () => {
    const row = await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      endpoint: "https://wazuh.example.com",
      ...base,
    });

    expect(row.id).toBeDefined();
    expect(row.sourceKey).toBe("wazuh-central");
    expect(row.sourceType).toBe("deployment");
    expect(row.endpoint).toBe("https://wazuh.example.com");
    expect(row.credentialScope).toBe("api-key-in-env");
    expect(row.enabled).toBe(true);
    expect(row.lastSuccessAt).toBeNull();
    expect(row.itemCount).toBeNull();
    expect(row.parseErrorCount).toBe(0);
    expect(row.freshnessSlaMs).toBeNull();
    expect(row.contractVersion).toBeNull();
    expect(row.lastError).toBeNull();
    expect(row.updatedAt).toBeInstanceOf(Date);
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.createdByUserId).toBeNull();
  });

  it("preserves analyst state on re-upsert (no unconditional status reset)", async () => {
    const first = await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
      itemCount: 100,
      enabled: false,
    });

    const second = await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
      endpoint: "https://new-host.example.com",
    });

    // analyst-captured state preserved — enabled and itemCount survive
    expect(second.enabled).toBe(false);
    expect(second.itemCount).toBe(100);
    // structural fields updated
    expect(second.endpoint).toBe("https://new-host.example.com");
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });

  it("recordIngestSuccess updates timestamps and item count", async () => {
    await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
    });

    const row = await recordIngestSuccess(db, "wazuh-central", {
      itemCount: 42,
      lastError: null,
    });

    expect(row.lastSuccessAt).toBeInstanceOf(Date);
    expect(row.lastEventAt).toBeInstanceOf(Date);
    expect(row.itemCount).toBe(42);
    expect(row.lastError).toBeNull();
  });

  it("recordIngestFailure updates lastEventAt + increments parseErrorCount but NOT lastSuccessAt", async () => {
    const init = await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
    });
    await recordIngestSuccess(db, "wazuh-central", { itemCount: 10 });

    const row = await recordIngestFailure(db, "wazuh-central", "JSON parse error on line 3");

    // lastSuccessAt still points to the prior successful ingest
    expect(row.lastSuccessAt).not.toBeNull();
    expect(row.parseErrorCount).toBe(1);
    expect(row.lastError).toBe("JSON parse error on line 3");
  });

  it("setSourceEnabled toggles flag without touching other state", async () => {
    await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "feed",
      credentialScope: "iam-role",
      freshnessSlaMs: 3600_000,
    });

    const row = await setSourceEnabled(db, "wazuh-central", false);
    expect(row.enabled).toBe(false);
    expect(row.freshnessSlaMs).toBe(3600_000);
    expect(row.itemCount).toBeNull();
  });

  it("setFreshnessSla validates bounds (rejects negative and >24h)", async () => {
    await upsertSourceCoverage(db, {
      sourceKey: "wazuh-central",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
    });

    await expect(setFreshnessSla(db, "wazuh-central", -1))
      .rejects.toMatchObject({ code: "bad_request", status: 400 });
    await expect(setFreshnessSla(db, "wazuh-central", 86_400_001))
      .rejects.toMatchObject({ code: "bad_request", status: 400 });
    await expect(setFreshnessSla(db, "wazuh-central", 0))
      .resolves.toBeDefined();
    await expect(setFreshnessSla(db, "wazuh-central", 86_400_000))
      .resolves.toBeDefined();
  });

  it("listStaleSources returns only enabled sources past their SLA", async () => {
    await upsertSourceCoverage(db, {
      sourceKey: "fast-source",
      sourceType: "deployment",
      credentialScope: "api-key-in-env",
      freshnessSlaMs: 1, // 1ms SLA — will be stale immediately
    });
    // Do NOT call recordIngestSuccess — lastSuccessAt stays null, so it is stale
    expect((await listStaleSources(db)).length).toBeGreaterThan(0);

    await upsertSourceCoverage(db, {
      sourceKey: "disabled-source",
      sourceType: "manual",
      credentialScope: "none",
      enabled: false,
      freshnessSlaMs: 1,
    });
    // Disabled source should not appear in stale list
    const stale = await listStaleSources(db);
    const keys = stale.map((s) => s.sourceKey);
    expect(keys).not.toContain("disabled-source");
    expect(keys).toContain("fast-source");
  });

  it("listSourceCoverage filters by sourceType and enabled", async () => {
    await upsertSourceCoverage(db, {
      sourceKey: "s1",
      sourceType: "deployment",
      credentialScope: "x",
    });
    await upsertSourceCoverage(db, {
      sourceKey: "s2",
      sourceType: "feed",
      credentialScope: "y",
      enabled: false,
    });
    await upsertSourceCoverage(db, {
      sourceKey: "s3",
      sourceType: "deployment",
      credentialScope: "z",
    });

    const all = await listSourceCoverage(db);
    expect(all).toHaveLength(3);

    const deployments = await listSourceCoverage(db, { sourceType: "deployment" });
    expect(deployments).toHaveLength(2);

    const enabled = await listSourceCoverage(db, { enabled: true });
    expect(enabled).toHaveLength(2);
  });

  it("throws 400 when sourceKey or credentialScope is missing", async () => {
    await expect(
      // @ts-expect-error — intentional missing sourceKey
      upsertSourceCoverage(db, { sourceType: "deployment", credentialScope: "x" }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });

    await expect(
      // @ts-expect-error — intentional missing credentialScope
      upsertSourceCoverage(db, { sourceKey: "s1", sourceType: "deployment" }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 400 when credentialScope contains a raw secret pattern", async () => {
    await expect(
      upsertSourceCoverage(db, {
        sourceKey: "s1",
        sourceType: "deployment",
        credentialScope: "api-key: supersecrettoken1234567890abcdef",
      }),
    ).rejects.toMatchObject({ code: "bad_request", status: 400 });
  });

  it("throws 404 for recordIngestSuccess/recordIngestFailure/setSourceEnabled on unknown key", async () => {
    await expect(recordIngestSuccess(db, "missing-key")).rejects.toMatchObject({
      code: "not_found", status: 404,
    });
    await expect(recordIngestFailure(db, "missing-key", "err")).rejects.toMatchObject({
      code: "not_found", status: 404,
    });
    await expect(setSourceEnabled(db, "missing-key", true)).rejects.toMatchObject({
      code: "not_found", status: 404,
    });
  });
});
