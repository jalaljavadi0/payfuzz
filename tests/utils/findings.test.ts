import { describe, expect, it } from 'vitest';
import type { Finding } from '../../src/types';
import { compareFindings, countBySeverity, worstSeverity } from '../../src/utils/findings';

function finding(overrides: Partial<Finding>): Finding {
  return {
    scenario: 'float_drift',
    rule: 'PF-FLOAT-002',
    severity: 'medium',
    title: 'Money arithmetic',
    file: 'a.ts',
    line: 1,
    column: 1,
    snippet: 'total + fee',
    risk: 'risk',
    fix: 'fix',
    ...overrides,
  };
}

describe('finding helpers', () => {
  it('orders by severity, then file, line and column', () => {
    const sorted = [
      finding({ severity: 'low', file: 'a.ts' }),
      finding({ severity: 'high', file: 'b.ts', line: 9 }),
      finding({ severity: 'medium', file: 'b.ts', line: 2 }),
      finding({ severity: 'medium', file: 'a.ts', line: 5, column: 8 }),
      finding({ severity: 'medium', file: 'a.ts', line: 5, column: 2 }),
    ].sort(compareFindings);

    expect(
      sorted.map((item) => `${item.severity}:${item.file}:${item.line}:${item.column}`),
    ).toEqual([
      'high:b.ts:9:1',
      'medium:a.ts:5:2',
      'medium:a.ts:5:8',
      'medium:b.ts:2:1',
      'low:a.ts:1:1',
    ]);
  });

  it('counts and reports the worst severity', () => {
    const findings = [
      finding({ severity: 'low' }),
      finding({ severity: 'high' }),
      finding({ severity: 'high' }),
    ];

    expect(countBySeverity(findings)).toEqual({ high: 2, medium: 0, low: 1 });
    expect(worstSeverity(findings)).toBe('high');
    expect(worstSeverity([])).toBeUndefined();
  });
});
