import type { Finding, Severity } from '../types';
import { severityRank } from './severity';

/** Highest severity first, then stable by file/line/column. */
export function compareFindings(a: Finding, b: Finding): number {
  const bySeverity = severityRank(b.severity) - severityRank(a.severity);
  if (bySeverity !== 0) return bySeverity;
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  return a.column - b.column;
}

export function countBySeverity(findings: readonly Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return counts;
}

export function worstSeverity(findings: readonly Finding[]): Severity | undefined {
  let worst: Severity | undefined;
  for (const finding of findings) {
    if (worst === undefined || severityRank(finding.severity) > severityRank(worst)) {
      worst = finding.severity;
    }
  }
  return worst;
}
