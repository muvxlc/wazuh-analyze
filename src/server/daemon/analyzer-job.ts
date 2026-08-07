import { isNull, and, gte, asc, eq } from "drizzle-orm";
import { Database } from "../db/types";
import { AppConfig } from "../config";
import { ActorContext } from "../authorization/permissions";
import { alerts, alertAnalyses } from "../db/schema";
import { runAlertAnalysis } from "../ai/analyze-service";
import { correlateAlert } from "../incidents/correlator";
import { RequestMetadata } from "../http/request-metadata";
import { randomUUID } from "crypto";

const BATCH_SIZE = 5;
const INTER_ALERT_DELAY_MS = 2000;

export async function analyzeBacklog(
  db: Database,
  actor: ActorContext,
  effConfig: AppConfig,
  isInterrupted: () => boolean
) {
  if (isInterrupted()) return;

  // 1. Find alerts without analysis row, matching level threshold
  const pending = await db
    .select({
      id: alerts.id,
      level: alerts.level,
    })
    .from(alerts)
    .leftJoin(alertAnalyses, eq(alertAnalyses.alertId, alerts.id))
    .where(
      and(
        isNull(alertAnalyses.id),
        gte(alerts.level, effConfig.socAutoAnalyzeMinLevel)
      )
    )
    .orderBy(asc(alerts.ingestedAt)) // oldest first
    .limit(BATCH_SIZE);

  if (pending.length === 0 || isInterrupted()) return;

  console.log(`[Daemon] Found ${pending.length} pending alerts for analysis`);

  // 2. Process sequentially to respect AI concurrency/rate limits
  for (const item of pending) {
    if (isInterrupted()) break;

    console.log(`[Daemon] Auto-analyzing alert ${item.id} (level ${item.level})`);
    try {
      const metadata: RequestMetadata = {
        requestId: randomUUID(),
        ip: "127.0.0.1",
        userAgent: "Wazuh SOC Daemon",
      };

      // Run analysis (with full context enrichment)
      await runAlertAnalysis(
        db,
        actor,
        item.id,
        { enrich: true },
        metadata,
        effConfig
      );

      // Trigger correlation immediately after successful analysis
      await correlateAlert(db, item.id);

    } catch (err) {
      console.error(`[Daemon] Failed to analyze alert ${item.id}:`, err);
      // Skip and continue — next sweep will retry,
      // ponytail: consider adding a max_retries tracking table if this blocks
    }

    if (!isInterrupted()) {
      await new Promise(r => setTimeout(r, INTER_ALERT_DELAY_MS));
    }
  }
}
