import { describe, expect, it } from 'vitest';
import { raceConditionScenario } from '../../src/scenarios/raceCondition';
import { analyze, rulesOf } from '../helpers/analyze';

describe('race condition scenario', () => {
  it('flags a direct read-modify-write on a shared balance', () => {
    const code = `
      async function withdraw(account: { balance: number }, amount: number) {
        await db.load(account);
        account.balance -= amount;
      }
    `;

    const findings = analyze(raceConditionScenario, code);

    expect(rulesOf(findings)).toContain('PF-RACE-001');
    expect(findings.find((finding) => finding.rule === 'PF-RACE-001')?.severity).toBe('high');
  });

  it('keeps a direct read-modify-write at medium severity without an await', () => {
    const code = `
      function withdraw(account: { balance: number }, amount: number) {
        account.balance -= amount;
      }
    `;

    const findings = analyze(raceConditionScenario, code);
    expect(findings[0]?.severity).toBe('medium');
  });

  it('does not flag a local accumulator', () => {
    const code = `
      function totalOf(prices: number[]) {
        let total = 0;
        for (const price of prices) {
          total += price;
        }
        return total;
      }
    `;

    expect(analyze(raceConditionScenario, code)).toEqual([]);
  });

  it('flags a balance copied into a local and written back through an update call', () => {
    const code = `
      async function withdraw(account: { id: string; balance: number }, amount: number) {
        const nextBalance = account.balance - amount;
        await db.accounts.update({ id: account.id, balance: nextBalance });
      }
    `;

    const findings = analyze(raceConditionScenario, code);

    expect(rulesOf(findings)).toEqual(['PF-RACE-001']);
    expect(findings[0]?.severity).toBe('high');
    expect(findings[0]?.evidence).toContain('nextBalance');
  });

  it('follows the local value into a money-named helper function', () => {
    const code = `
      async function deposit(account: { id: string; balance: number }, amount: number) {
        const nextBalance = account.balance + amount;
        await saveBalance(account.id, nextBalance);
      }
    `;

    expect(rulesOf(analyze(raceConditionScenario, code))).toEqual(['PF-RACE-001']);
  });

  it('flags check-then-act when the guarded branch awaits a write', () => {
    const code = `
      async function pay(account: { id: string; balance: number }, amount: number) {
        if (account.balance >= amount) {
          await db.accounts.update({ id: account.id, balance: account.balance - amount });
        }
      }
    `;

    const findings = analyze(raceConditionScenario, code);

    expect(rulesOf(findings)).toContain('PF-RACE-002');
    expect(findings.find((finding) => finding.rule === 'PF-RACE-002')?.severity).toBe('high');
  });

  it('does not treat a guard whose branch has no write as check-then-act', () => {
    const code = `
      async function describe(account: { balance: number }) {
        if (account.balance > 0) {
          await log('funded');
        }
      }
    `;

    expect(rulesOf(analyze(raceConditionScenario, code))).not.toContain('PF-RACE-002');
  });

  it('flags a balance read before an await and written back after it', () => {
    const code = `
      async function settle(accountId: string) {
        const accountBalance = await db.accounts.findOne(accountId);
        await notify(accountId);
        await db.accounts.update({ id: accountId, balance: accountBalance });
      }
    `;

    const findings = analyze(raceConditionScenario, code);

    expect(rulesOf(findings)).toContain('PF-RACE-003');
    expect(findings.find((finding) => finding.rule === 'PF-RACE-003')?.evidence).toContain(
      'accountBalance',
    );
  });

  it('does not flag a stale read without an intervening await', () => {
    const code = `
      async function settle(accountId: string) {
        const accountBalance = await db.accounts.findOne(accountId);
        await db.accounts.update({ id: accountId, balance: accountBalance });
      }
    `;

    expect(rulesOf(analyze(raceConditionScenario, code))).not.toContain('PF-RACE-003');
  });

  it('ignores plain arithmetic that never touches shared state', () => {
    expect(analyze(raceConditionScenario, 'const total = price + fee;')).toEqual([]);
  });
});
