import "server-only";

export const SESSION_COOKIE = "wazuh_session";

export interface SessionCookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  path: string;
}

export function sessionCookieOptions(nodeEnv: string): SessionCookieOptions {
  return {
    httpOnly: true,
    secure: nodeEnv !== "development",
    sameSite: "lax",
    path: "/",
  };
}
