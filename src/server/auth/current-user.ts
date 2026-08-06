import "server-only";

import { cookies } from "next/headers";

import type { Database } from "../db/types";
import { authenticateRequest } from "./authenticate";
import { SESSION_COOKIE } from "./cookies";

import { AppError } from "../errors";

export async function currentUser(db: Database) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? null;
  if (!token) return null;
  try {
    return await authenticateRequest(db, token);
  } catch (error) {
    if (error instanceof AppError && error.code === "unauthenticated") {
      return null;
    }
    throw error;
  }
}
