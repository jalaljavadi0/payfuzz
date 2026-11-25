import { describe, expect, it } from 'vitest';
import { overflowAmountScenario } from '../../src/scenarios/overflowAmount';
import { analyze, rulesOf } from '../helpers/analyze';

describe('overflow amount scenario', () => {
  it('flags an unguarded monetary parameter that reaches an awaited write', () => {
    const code = `
      async function charge(accountId: string, amount: number) {
        await db.accounts.update({ id: accountId, balance: amount });
      }
    `;

    const findings = analyze(overflowAmountScenario, code);
    const finding = findings.find((candidate) => candidate.rule === 'PF-OVERFLOW-001');

    expect(finding?.severity).toBe('high');
    expect(finding?.evidence).toContain('awaited write');
  });

  it('keeps an unguarded amount at medium severity when it never reaches a write', () => {
    const code = `
      async function quote(amount: number) {
        return format(amount);
      }
    `;

    const finding = analyze(overflowAmountScenario, code).find(
      (candidate) => candidate.rule === 'PF-OVERFLOW-001',
    );
    expect(finding?.severity).toBe('medium');
  });

  it('accepts an explicit sign or finiteness guard', () => {
    const code = `
      function charge(amount: number) {
        if (amount <= 0) throw new Error('invalid amount');
        return amount;
      }
    `;

    expect(rulesOf(analyze(overflowAmountScenario, code))).not.toContain('PF-OVERFLOW-001');
  });

  it('flags a literal above the safe integer range with the value actually stored', () => {
    const findings = analyze(overflowAmountScenario, 'const MAX_PAYMENT = 9007199254740993;');
    const finding = findings.find((candidate) => candidate.rule === 'PF-OVERFLOW-002');

    expect(finding?.severity).toBe('high');
    expect(finding?.evidence).toContain('9007199254740992');
  });

  it('flags an unvalidated parse of a request amount', () => {
    const code = `
      app.post('/charge', (req, res) => {
        const amount = Number(req.body.amount);
        return res.json({ amount });
      });
    `;

    const finding = analyze(overflowAmountScenario, code).find(
      (candidate) => candidate.rule === 'PF-OVERFLOW-003',
    );
    expect(finding?.severity).toBe('high');
    expect(finding?.evidence).toContain('1e400');
  });

  it('accepts a parse followed by a safe-integer check', () => {
    const code = `
      function parseAmount(raw: string): number {
        const amount = Number(raw);
        if (!Number.isSafeInteger(amount)) throw new Error('invalid amount');
        return amount;
      }
    `;

    expect(rulesOf(analyze(overflowAmountScenario, code))).not.toContain('PF-OVERFLOW-003');
  });

  it('ignores parsing that is not money related', () => {
    expect(analyze(overflowAmountScenario, 'const page = Number(cursorText);')).toEqual([]);
  });

  it('reports one unsafe literal per line', () => {
    const code = 'const big = 1e30;\nconst bigger = 1e31;';
    const findings = analyze(overflowAmountScenario, code);

    expect(findings.filter((finding) => finding.rule === 'PF-OVERFLOW-002')).toHaveLength(2);
  });
});
