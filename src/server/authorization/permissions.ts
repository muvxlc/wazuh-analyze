export type Role = "super_admin" | "admin" | "user";
export type Locale = "en" | "th";
export type Permission = string;
export type OverrideEffect = "allow" | "deny";

export const ROLES = ["super_admin", "admin", "user"] as const;
export type RoleValue = (typeof ROLES)[number];

export const PERMISSIONS = {
  dashboardRead: "dashboard.read",
  alertsRead: "alerts.read",
  alertsList: "alerts.list",
  alertsDetails: "alerts.details",
  alertsAcknowledge: "alerts.acknowledge",
  alertsResolve: "alerts.resolve",
  alertsReopen: "alerts.reopen",
  alertsAnalyze: "alerts.analyze",
  agentsRead: "agents.read",
  agentsList: "agents.list",
  agentsManage: "agents.manage",
  incidentsRead: "incidents.read",
  incidentsList: "incidents.list",
  incidentsManage: "incidents.manage",
  usersRead: "users.read",
  usersManage: "users.manage",
  invitesManage: "invites.manage",
  rolesRead: "roles.read",
  rolesManage: "roles.manage",
  sessionsRevoke: "sessions.revoke",
  auditRead: "audit.read",
  settingsManage: "settings.manage",
  chatUse: "chat.use",
  superAdminsManage: "super_admins.manage",
  overridesManage: "overrides.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];
export type PermissionValue = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export interface ActorContext {
  userId: string;
  role: Role;
  permissions: Set<string>;
}
