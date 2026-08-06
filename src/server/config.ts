import "server-only";

import { z } from "zod";

const positiveInteger = z.coerce.number().int().positive();

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    APP_URL: z.url(),
    SESSION_SECRET: z.string().min(32),
    WEBHOOK_HMAC_SECRET: z.string().min(32),
    WEBHOOK_MAX_BODY_BYTES: positiveInteger.default(1_048_576),
    WEBHOOK_REPLAY_WINDOW_SECONDS: positiveInteger.default(300),
    ALERT_RETENTION_DAYS: positiveInteger.default(90),
    MAINTENANCE_BATCH_SIZE: positiveInteger.default(1_000),
    SOC_AUTO_ANALYZE: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SOC_AUTO_ANALYZE_MIN_LEVEL: positiveInteger.default(7),
    TI_PROVIDERS: z.string().default("abuseipdb,otx"),
    ABUSEIPDB_API_KEY: z.string().optional(),
    OTX_API_KEY: z.string().optional(),
    TI_MIN_LEVEL: positiveInteger.default(7),
    TI_CACHE_TTL_DAYS: positiveInteger.default(30),
    WAZUH_API_URL: z.url(),
    WAZUH_USERNAME: z.string().min(1),
    WAZUH_PASSWORD: z.string().min(1),
    WAZUH_CA_PATH: z.string().optional(),
    WAZUH_ALLOW_INSECURE_TLS: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    SETTINGS_ENCRYPTION_KEY: z.string().min(32),
  })
  .superRefine((environment, context) => {
    if (
      environment.NODE_ENV === "production" &&
      new URL(environment.WAZUH_API_URL).protocol !== "https:"
    ) {
      context.addIssue({
        code: "custom",
        path: ["WAZUH_API_URL"],
        message: "WAZUH_API_URL must use HTTPS in production",
      });
    }

    if (
      environment.NODE_ENV === "production" &&
      environment.WAZUH_ALLOW_INSECURE_TLS
    ) {
      context.addIssue({
        code: "custom",
        path: ["WAZUH_ALLOW_INSECURE_TLS"],
        message: "WAZUH_ALLOW_INSECURE_TLS cannot be true in production",
      });
    }
  });

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  databaseUrl: string;
  appUrl: URL;
  sessionSecret: string;
  webhookHmacSecret: string;
  webhookMaxBodyBytes: number;
  webhookReplayWindowSeconds: number;
  alertRetentionDays: number;
  maintenanceBatchSize: number;
  socAutoAnalyze: boolean;
  socAutoAnalyzeMinLevel: number;
  ti?: {
    providers: string[];
    abuseipdbKey: string | null;
    otxKey: string | null;
    minLevel: number;
    cacheTtlDays: number;
  };
  wazuh: {
    apiUrl: URL;
    username: string;
    password: string;
    caPath: string | null;
    allowInsecureTls: boolean;
  };
  settingsEncryptionKey: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  const parsed = environmentSchema.safeParse(env);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid application configuration: ${message}`);
  }

  const environment = parsed.data;

  return {
    nodeEnv: environment.NODE_ENV,
    databaseUrl: environment.DATABASE_URL,
    appUrl: new URL(environment.APP_URL),
    sessionSecret: environment.SESSION_SECRET,
    webhookHmacSecret: environment.WEBHOOK_HMAC_SECRET,
    webhookMaxBodyBytes: environment.WEBHOOK_MAX_BODY_BYTES,
    webhookReplayWindowSeconds: environment.WEBHOOK_REPLAY_WINDOW_SECONDS,
    alertRetentionDays: environment.ALERT_RETENTION_DAYS,
    maintenanceBatchSize: environment.MAINTENANCE_BATCH_SIZE,
    socAutoAnalyze: environment.SOC_AUTO_ANALYZE,
    socAutoAnalyzeMinLevel: environment.SOC_AUTO_ANALYZE_MIN_LEVEL,
    ti: {
      providers: environment.TI_PROVIDERS.split(",").map((s) => s.trim()).filter(Boolean),
      abuseipdbKey: environment.ABUSEIPDB_API_KEY?.trim() || null,
      otxKey: environment.OTX_API_KEY?.trim() || null,
      minLevel: environment.TI_MIN_LEVEL,
      cacheTtlDays: environment.TI_CACHE_TTL_DAYS,
    },
    wazuh: {
      apiUrl: new URL(environment.WAZUH_API_URL),
      username: environment.WAZUH_USERNAME,
      password: environment.WAZUH_PASSWORD,
      caPath: environment.WAZUH_CA_PATH?.trim() || null,
      allowInsecureTls: environment.WAZUH_ALLOW_INSECURE_TLS,
    },
    settingsEncryptionKey: environment.SETTINGS_ENCRYPTION_KEY,
  };
}
