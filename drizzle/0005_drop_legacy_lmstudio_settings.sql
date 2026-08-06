-- Drop legacy single-config LM Studio settings now that AI providers are managed
-- exclusively via the ai_connections table (Settings -> AI).
-- These keys are no longer read by any code path.
DELETE FROM system_settings
WHERE key IN (
  'lmStudioBaseUrl',
  'lmStudioModel',
  'lmStudioApiKey',
  'lmStudioTimeoutMs',
  'lmStudioTimezone'
);
