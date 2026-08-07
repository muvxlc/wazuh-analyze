import "server-only";

import type { AppConfig } from "../config";
import type { WazuhConfig } from "../wazuh/types";
import { wazuhPut } from "../wazuh/http-client";

/**
 * Call Wazuh active-response endpoint for an approved action.
 * Returns success result; throws on failure (pg-boss retries).
 */
export async function executeAction(
  config: AppConfig,
  action: { command: string; payload: Record<string, unknown> },
  fetchFn?: typeof fetch,
): Promise<void> {
  const wazuhConfig = config.wazuh as WazuhConfig & { apiUrl: URL };
  const agents = Array.isArray(action.payload.agents)
    ? (action.payload.agents as string[])
    : [];
  const arguments_ = Array.isArray(action.payload.arguments)
    ? (action.payload.arguments as string[])
    : [];

  await wazuhPut(
    wazuhConfig,
    "/active-response",
    {
      agents: agents.length > 0 ? agents : ["000"], // default to manager if no agent specified
      command: action.command,
      arguments: arguments_,
    },
    { timeoutMs: 15_000, fetchFn },
  );
}
