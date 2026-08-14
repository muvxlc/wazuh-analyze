export type AuditAction =
  | "user.role.update"
  | "user.status.update"
  | "user.create"
  | "user.deactivate"
  | "session.revoke"
  | "alert.acknowledge"
  | "alert.resolve"
  | "alert.reopen"
  | "invite.accept"
  | "invite.revoke"
  | "system.health"
  | "settings.update"
  | "ai_connection.create"
  | "ai_connection.update"
  | "ai_connection.delete"
  | "role_permission.update"
  | "alert.analyze"
  | "incident.create"
  | "incident.investigate"
  | "incident.mitigate"
  | "incident.resolve"
  | "incident.reopen"
  | "incident.assign"
  | "notification.send"
  | "action.propose"
  | "action.approve"
  | "action.execute"
  | "alert.fp_suppress"
  | "fp_signature.create"
  | "fp_signature.delete"
  | "fp_signature.renew";

export interface AuditEventInput {
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  action: AuditAction;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string;
  detail: Record<string, unknown>;
}

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  targetType: string | null;
  targetId: string | null;
  action: AuditAction;
  occurredAt: Date;
  requestId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  detail: Record<string, unknown>;
}
