import type { Role, Locale } from "../authorization/permissions";

export interface UserSummary {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  locale: Locale;
  isActive: boolean;
}
