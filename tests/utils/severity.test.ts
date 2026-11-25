import { describe, expect, it } from 'vitest';
import { adjustSeverity, severityRank } from '../../src/utils/severity';

describe('severity helpers', () => {
  it('ranks low below medium below high', () => {
    expect(severityRank('low')).toBeLessThan(severityRank('medium'));
    expect(severityRank('medium')).toBeLessThan(severityRank('high'));
  });

  it('shifts one level without leaving the range', () => {
    expect(adjustSeverity('medium', 'high')).toBe('high');
    expect(adjustSeverity('medium', 'low')).toBe('low');
    expect(adjustSeverity('medium', 'medium')).toBe('medium');
    expect(adjustSeverity('high', 'high')).toBe('high');
    expect(adjustSeverity('low', 'low')).toBe('low');
  });
});
