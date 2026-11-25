import { describe, expect, it } from 'vitest';
import { floatDriftScenario } from '../../src/scenarios/floatDrift';
import { analyze, rulesOf } from '../helpers/analyze';

describe('float drift scenario', () => {
  it('flags decimal literal arithmetic and shows the drifted value', () => {
    const findings = analyze(floatDriftScenario, 'export const total = 0.1 + 0.2;');

    expect(findings).toHaveLength(1);
    expect(findings[0]?.rule).toBe('PF-FLOAT-001');
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.scenario).toBe('float_drift');
    expect(findings[0]?.evidence).toContain('0.30000000000000004');
  });

  it('flags arithmetic between money identifiers at medium severity', () => {
    const findings = analyze(floatDriftScenario, 'export const total = price + fee;');

    expect(rulesOf(findings)).toEqual(['PF-FLOAT-002']);
    expect(findings[0]?.severity).toBe('medium');
    expect(findings[0]?.evidence).toBeUndefined();
  });

  it('flags compound assignment on a money amount', () => {
    const findings = analyze(floatDriftScenario, 'total += fee;');

    expect(rulesOf(findings)).toEqual(['PF-FLOAT-002']);
  });

  it('flags exact equality on a money amount', () => {
    const findings = analyze(floatDriftScenario, 'if (total === amount) refund();');

    expect(rulesOf(findings)).toEqual(['PF-FLOAT-003']);
  });

  it('ignores string concatenation used for formatting', () => {
    expect(analyze(floatDriftScenario, "const label = '$' + total;")).toEqual([]);
  });

  it('ignores integer minor units, which are the recommended representation', () => {
    const code = 'const totalCents = priceCents + feeCents;';
    expect(analyze(floatDriftScenario, code)).toEqual([]);
  });

  it('reports one finding per rule per line for a nested chain', () => {
    const findings = analyze(floatDriftScenario, 'const total = price + fee + tax;');

    expect(rulesOf(findings)).toEqual(['PF-FLOAT-002']);
  });

  it('raises and relaxes severity with the sensitivity knob', () => {
    const code = 'const total = price + fee;';

    expect(analyze(floatDriftScenario, code, 'high')[0]?.severity).toBe('high');
    expect(analyze(floatDriftScenario, code, 'low')[0]?.severity).toBe('low');
    expect(analyze(floatDriftScenario, 'const t = 0.1 + 0.2;', 'low')[0]?.severity).toBe('medium');
  });

  it('returns nothing for code without money arithmetic', () => {
    expect(analyze(floatDriftScenario, 'const cursor = page + 1;')).toEqual([]);
  });
});
