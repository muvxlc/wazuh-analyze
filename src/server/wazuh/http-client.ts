import "server-only";

import type { WazuhConfig } from "./types";
import { WazuhError } from "./errors";
import { Agent, fetch as undiciFetch } from "undici";

/** Timeout wrapper for native fetch via AbortSignal. */
function fetchWithTimeout(
  url: string | URL,
  init: RequestInit & { dispatcher?: Agent },
  timeoutMs: number,
  fetchFn: typeof fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetchFn(url.toString(), { ...init, signal: controller.signal } as RequestInit).finally(
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
  fetchFn: typeof fetch = undiciFetch as unknown as typeof fetch,
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
  if (config.allowInsecureTls) {
    return { dispatcher: new Agent({ connect: { rejectUnauthorized: false } }) };
  }
  if (config.caPath) {
    return { dispatcher: new Agent({ connect: { ca: config.caPath } }) };
  }
  return {};
}

export interface WazuhGetOptions {
  /** Per-request timeout (default 10s). */
  timeoutMs?: number;
  /** Query-string params appended to `path`. */
  query?: Record<string, string | number>;
  /** Injectable fetch (mainly for tests). */
  fetchFn?: typeof fetch;
}

/**
 * Generic authenticated GET against the Wazuh REST API. Handles token
 * acquisition, TLS options, timeout, and 401 cache invalidation. Fetchers
 * (agents, inventory) compose this instead of reimplementing the round-trip.
 * ponytail: add POST/PUT + JSON body when Phase 5 active-response needs it.
 */
export async function wazuhGet(
  config: WazuhConfig,
  path: string,
  options: WazuhGetOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? (undiciFetch as unknown as typeof fetch);
  const token = await authenticate(config, fetchFn);
  const url = new URL(path, config.apiUrl);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      ...buildTlsOptions(config),
    },
    options.timeoutMs ?? 10_000,
    fetchFn,
  );

  if (!res.ok) {
    // Clear cache on 401 so next call re-authenticates
    if (res.status === 401) clearTokenCache();
    throw new WazuhError(
      "wazuh_api_error",
      res.status,
      `Wazuh API ${path} returned ${res.status}`,
    );
  }

  return res.json();
}

export async function fetchAgents(
  config: WazuhConfig,
  fetchFn: typeof fetch = undiciFetch as unknown as typeof fetch,
): Promise<unknown> {
  return wazuhGet(config, "/agents", {
    query: { limit: 500, offset: 0 },
    timeoutMs: 10_000,
    fetchFn,
  });
}

export async function wazuhPut(
  config: WazuhConfig,
  path: string,
  body: unknown,
  options: WazuhGetOptions = {},
): Promise<unknown> {
  const fetchFn = options.fetchFn ?? (undiciFetch as unknown as typeof fetch);
  const token = await authenticate(config, fetchFn);
  const url = new URL(path, config.apiUrl);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetchWithTimeout(
    url,
    {
      method: "PUT",
      headers: {
        authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      ...buildTlsOptions(config),
    },
    options.timeoutMs ?? 10_000,
    fetchFn,
  );

  if (!res.ok) {
    if (res.status === 401) clearTokenCache();
    throw new WazuhError(
      "wazuh_api_error",
      res.status,
      `Wazuh API ${path} returned ${res.status}`,
    );
  }

  return res.json();
}
