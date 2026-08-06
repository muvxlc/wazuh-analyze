import { AppError } from "../errors";

export function requirePermission(
  permissions: ReadonlySet<string>,
  permission: string,
): void {
  if (!permissions.has(permission)) {
    throw new AppError("forbidden", 403, { permission });
  }
}
