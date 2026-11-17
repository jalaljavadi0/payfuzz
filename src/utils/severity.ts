import type { Severity } from '../types';

const RANK: Record<Severity, number> = { low: 1, medium: 2, high: 3 };

const ORDER: readonly Severity[] = ['low', 'medium', 'high'];

export function severityRank(severity: Severity): number {
  return RANK[severity];
}

/**
 * Sensitivity shifts a rule's base severity one level: `high` raises, `low` lowers.
 * Clamped so a rule never disappears or escalates past `high`.
 */
export function adjustSeverity(base: Severity, sensitivity: Severity): Severity {
  const delta = sensitivity === 'high' ? 1 : sensitivity === 'low' ? -1 : 0;
  const rank = Math.min(RANK.high, Math.max(RANK.low, RANK[base] + delta));
  return ORDER[rank - 1] ?? base;
}
