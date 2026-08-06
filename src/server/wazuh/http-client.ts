import "server-only";

import type { WazuhConfig } from "./types";
import { WazuhError } from "./errors";

/** Timeout wrapper for native fetch via AbortSignal. */
function fetchWithTimeout(
  url: string | URL,
  init: RequestInit,
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchFn(url.toString(), { ...init, signal: controller.signal }).finally(
    () => clearTimeout(timer),
  );
}

interface TokenCache {
  token: string;
  expiresAt: number; // epoch ms
}

let tokenCache: TokenCache | null = null;

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    if (typeof payload.exp === "number") return payload.exp * 1000;
    return null;
  } catch {
    return null;
  }
}

export async function authenticate(
  config: WazuhConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now) {
    return tokenCache.token;
  }

  const authUrl = new URL("/security/user/authenticate?raw=true", config.apiUrl);
  const headers: Record<string, string> = {
    authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString("base64")}`,
  };

  const tlsOptions = buildTlsOptions(config);

  const res = await fetchWithTimeout(
    authUrl,
    { method: "POST", headers, ...tlsOptions },
    5_000,
    fetchFn,
  );

  if (!res.ok) {
    throw new WazuhError(
      "wazuh_auth_failed",
      res.status,
      `Wazuh auth failed: ${res.status}`,
    );
  }

  const token = (await res.text()).trim();
  if (!token) {
    throw new WazuhError("wazuh_auth_empty", 500, "Empty auth token from Wazuh");
  }

  // Cache token until 60s before JWT expiry, or 4 minutes if unparseable
  const jwtExp = parseJwtExp(token);
  const expiresAt = jwtExp ? jwtExp - 60_000 : now + 240_000;

  tokenCache = { token, expiresAt };
  return token;
}

export function clearTokenCache(): void {
  tokenCache = null;
}

function buildTlsOptions(
  config: WazuhConfig,
): Record<string, unknown> {
  // Node.js native fetch doesn't support custom CA or rejectUnauthorized directly.
  // For environments using undici (Node 18+), dispatcher options handle TLS.
  // ponytail: TLS customization ceiling — upgrade to undici Agent when CA/insecure needed in prod.
  if (config.allowInsecureTls) {
    // In test/dev, set NODE_TLS_REJECT_UNAUTHORIZED=0 at process level.
    // This is validated to be blocked in production by config.ts.
    return {};
  }
  return {};
}

export async function fetchAgents(
  config: WazuhConfig,
  fetchFn: typeof fetch = globalThis.fetch,
): Promise<unknown> {
  const token = await authenticate(config, fetchFn);
  const agentsUrl = new URL("/agents?limit=500&offset=0", config.apiUrl);

  const res = await fetchWithTimeout(
    agentsUrl,
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    },
    10_000,
    fetchFn,
  );

  if (!res.ok) {
    // Clear cache on 401 so next call re-authenticates
    if (res.status === 401) clearTokenCache();
    throw new WazuhError(
      "wazuh_api_error",
      res.status,
      `Wazuh agents API returned ${res.status}`,
    );
  }

  return res.json();
}
