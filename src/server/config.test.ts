import { describe, expect, it } from "vitest";

import { loadConfig } from "./config";

function validEnv(overrides: Partial<NodeJS.ProcessEnv> = {}): NodeJS.ProcessEnv {
  return Object.assign(
    {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://dashboard:dashboard@localhost:5432/dashboard",
      APP_URL: "http://localhost:3000",
      SESSION_SECRET: "session-secret-at-least-32-characters",
      WEBHOOK_HMAC_SECRET: "webhook-secret-at-least-32-characters",
      WAZUH_API_URL: "https://wazuh.example.test:55000",
      WAZUH_USERNAME: "wazuh-user",
      WAZUH_PASSWORD: "wazuh-password",
      SETTINGS_ENCRYPTION_KEY: "settings-encryption-key-at-least-32-characters",
    },
    overrides,
  );
}

describe("loadConfig", () => {
  it("loads required settings and documented defaults", () => {
    const config = loadConfig(validEnv());

    expect(config).toMatchObject({
      nodeEnv: "test",
      databaseUrl: "postgresql://dashboard:dashboard@localhost:5432/dashboard",
      sessionSecret: "session-secret-at-least-32-characters",
      webhookHmacSecret: "webhook-secret-at-least-32-characters",
      webhookMaxBodyBytes: 1_048_576,
      webhookReplayWindowSeconds: 300,
      alertRetentionDays: 90,
      maintenanceBatchSize: 1_000,
      socAutoAnalyze: false,
      socAutoAnalyzeMinLevel: 7,
      wazuh: {
        username: "wazuh-user",
        password: "wazuh-password",
        caPath: null,
        allowInsecureTls: false,
      },
      settingsEncryptionKey: "settings-encryption-key-at-least-32-characters",
    });
    expect(config.appUrl).toEqual(new URL("http://localhost:3000"));
    expect(config.wazuh.apiUrl).toEqual(
      new URL("https://wazuh.example.test:55000"),
    );
  });

  it("rejects missing required configuration", () => {
    expect(() => loadConfig(validEnv({ DATABASE_URL: "" }))).toThrow(
      "DATABASE_URL",
    );
  });

  it.each(["SESSION_SECRET", "WEBHOOK_HMAC_SECRET", "SETTINGS_ENCRYPTION_KEY"])(
    "rejects short %s material",
    (key) => {
      expect(() => loadConfig(validEnv({ [key]: "too-short" }))).toThrow(key);
    },
  );

  it("rejects invalid positive integer settings", () => {
    expect(() =>
      loadConfig(validEnv({ WEBHOOK_REPLAY_WINDOW_SECONDS: "0" })),
    ).toThrow("WEBHOOK_REPLAY_WINDOW_SECONDS");
    expect(() =>
      loadConfig(validEnv({ SOC_AUTO_ANALYZE_MIN_LEVEL: "0" })),
    ).toThrow("SOC_AUTO_ANALYZE_MIN_LEVEL");
  });

  it("loads custom SOC analysis config when set", () => {
    const config = loadConfig(
      validEnv({
        SOC_AUTO_ANALYZE: "true",
        SOC_AUTO_ANALYZE_MIN_LEVEL: "12",
      }),
    );
    expect(config.socAutoAnalyze).toBe(true);
    expect(config.socAutoAnalyzeMinLevel).toBe(12);
  });

  it("rejects insecure Wazuh TLS in production", () => {
    expect(() =>
      loadConfig(
        validEnv({
          NODE_ENV: "production",
          WAZUH_ALLOW_INSECURE_TLS: "true",
        }),
      ),
    ).toThrow("WAZUH_ALLOW_INSECURE_TLS");
  });

  it("rejects a non-HTTPS Wazuh API URL in production", () => {
    expect(() =>
      loadConfig(
        validEnv({
          NODE_ENV: "production",
          WAZUH_API_URL: "http://wazuh.internal:55000",
        }),
      ),
    ).toThrow("WAZUH_API_URL");
  });

  it.each(["development", "test"] as const)(
    "allows an HTTP Wazuh API URL in %s",
    (nodeEnv) => {
      const config = loadConfig(
        validEnv({
          NODE_ENV: nodeEnv,
          WAZUH_API_URL: "http://wazuh.local:55000",
        }),
      );

      expect(config.wazuh.apiUrl).toEqual(
        new URL("http://wazuh.local:55000"),
      );
    },
  );
});
