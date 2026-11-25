import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanRepository } from '../../src/core/scan';
import { REPORT_MARKER, renderMarkdownReport } from '../../src/report/markdown';
import type { Finding } from '../../src/types';

const FIXED_DATE = new Date('2024-01-01T00:00:00.000Z');

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    scenario: 'race_condition',
    rule: 'PF-RACE-001',
    severity: 'medium',
    title: 'Read-modify-write on a shared balance',
    file: 'src/payments/wallet.ts',
    line: 4,
    column: 3,
    snippet: 'account.balance -= amount',
    risk: 'A later write erases the earlier one.',
    fix: 'Do the arithmetic in the database.',
    ...overrides,
  };
}

describe('renderMarkdownReport', () => {
  it('snapshots the report for the sample fixtures', async () => {
    const result = await scanRepository({
      rootDir: path.join(process.cwd(), 'tests', 'fixtures'),
    });

    const report = renderMarkdownReport({
      findings: result.findings,
      scannedFiles: result.scannedFiles,
      sensitivity: result.sensitivity,
      generatedAt: FIXED_DATE,
      version: '0.1.0',
    });

    expect(report).toMatchSnapshot();
  });

  it('states plainly when nothing was found', () => {
    const report = renderMarkdownReport({
      findings: [],
      scannedFiles: ['src/payments/clean.ts'],
      sensitivity: 'high',
      generatedAt: FIXED_DATE,
      version: '0.1.0',
    });

    expect(report).toContain(REPORT_MARKER);
    expect(report).toContain('## No payment-logic issues found');
    expect(report).toContain('**1** payment file');
    expect(report).not.toContain('## Summary');
  });

  it('defaults the date and version so a bare call still renders', () => {
    const report = renderMarkdownReport({ findings: [] });

    expect(report).toContain('# PayFuzz report');
    expect(report).toContain('0 payment files');
  });

  it('escapes pipes in a title and keeps the snippet fence intact', () => {
    const report = renderMarkdownReport({
      findings: [
        finding({
          title: 'Fee | tax mismatch',
          snippet: 'const x = `a${b}`;',
          evidence: '`0.1 + 0.2` evaluates to `0.30000000000000004`',
        }),
      ],
      scannedFiles: [],
      sensitivity: 'medium',
      generatedAt: FIXED_DATE,
      version: '0.1.0',
    });

    expect(report).toContain('Fee \\| tax mismatch');
    expect(report).toContain('**Simulated:**');
    expect(report).toContain('```ts');
  });

  it('picks a Python fence for .py files and skips the files section when nothing was scanned', () => {
    const report = renderMarkdownReport({
      findings: [finding({ file: 'billing/pay.py' })],
      scannedFiles: [],
      generatedAt: FIXED_DATE,
    });

    expect(report).toContain('```python');
    expect(report).not.toContain('<details>');
  });
});
