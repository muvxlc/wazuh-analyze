import { z } from "zod";

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const inviteAcceptanceSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  password: z.string(),
});
