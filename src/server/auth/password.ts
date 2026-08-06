import "server-only";

import argon2 from "argon2";

import { AppError } from "../errors";

const MIN_CODE_POINTS = 12;
const MAX_CODE_POINTS = 128;
const DENYLIST = new Set([
  "password",
  "passwordpassword",
  "123456789012",
  "qwertyuiopasdf",
  "letmein123456",
]);

function assertPasswordPolicy(password: string): void {
  const length = Array.from(password).length;
  if (length < MIN_CODE_POINTS || length > MAX_CODE_POINTS || DENYLIST.has(password.toLowerCase())) {
    throw new AppError("invalid_password", 400);
  }
}

export async function hashPassword(password: string): Promise<string> {
  assertPasswordPolicy(password);
  return argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password).catch(() => false);
}
