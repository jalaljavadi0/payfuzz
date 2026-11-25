import { describe, expect, it } from 'vitest';
import {
  isMonetaryIdentifier,
  isMoneyIdentifier,
  isSourcePath,
  matchPaymentPath,
} from '../../src/detectors/patterns';

describe('path matching', () => {
  it('explains a payment file by name and by directory', () => {
    const reasons = matchPaymentPath('src/payments/checkout.ts');

    expect(reasons).toContain('file name `checkout.ts`');
    expect(reasons).toContain('path `src/payments/`');
  });

  it('leaves unrelated files alone', () => {
    expect(matchPaymentPath('src/lib/strings.ts')).toEqual([]);
  });

  it('accepts every parseable extension plus Python', () => {
    for (const path of ['a.ts', 'a.tsx', 'a.js', 'a.jsx', 'a.mjs', 'a.cjs', 'a.py', 'A.PY']) {
      expect(isSourcePath(path)).toBe(true);
    }
    expect(isSourcePath('README.md')).toBe(false);
  });
});

describe('money identifiers', () => {
  it('treats minor units as money for detection purposes', () => {
    expect(isMonetaryIdentifier('amountCents')).toBe(true);
    expect(isMonetaryIdentifier('total_amount')).toBe(true);
  });

  it('excludes integer minor units from float-specific rules', () => {
    expect(isMoneyIdentifier('amountCents')).toBe(false);
    expect(isMoneyIdentifier('amountMinorUnits')).toBe(false);
  });

  it('recognises plain money names and rejects empty ones', () => {
    expect(isMoneyIdentifier('total')).toBe(true);
    expect(isMoneyIdentifier('balance')).toBe(true);
    expect(isMoneyIdentifier('')).toBe(false);
    expect(isMoneyIdentifier('__')).toBe(false);
  });
});
