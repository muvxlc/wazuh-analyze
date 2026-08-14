// Pure signature key builder for FP memory. No I/O, no side effects.
//
// Signature = (ruleId, agentId, level). srcip is deliberately excluded:
//   - Privacy: srcip is personal data; we do not persist it as a stable key.
//   - Noise reduction: srcip varies across real attacks and recon, so including
//     it fractures signatures and defeats the purpose of FP memory.
// A null/empty ruleId yields no signature (we refuse to suppress generic noise).

/**
 * Build the FP-memory signature key for an alert.
 *
 * @returns `${ruleId}|${agentId ?? "*"}|${level}`, or null when ruleId is
 *   null/empty (no signature without a rule — refuses to suppress generic noise).
 */
export function buildSignatureKey(
  ruleId: string | null,
  agentId: string | null,
  level: number,
): string | null {
  if (ruleId === null || ruleId === "") return null;
  return `${ruleId}|${agentId ?? "*"}|${level}`;
}
